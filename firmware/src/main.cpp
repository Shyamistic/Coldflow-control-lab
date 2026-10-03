#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include "safety.hpp"
#include "board.hpp"

SemaphoreHandle_t inputMutex;
QueueHandle_t shieldQueue;
coldflow::Input inputs;
coldflow::Setpoint status;
std::array<float, 2> applied{};
OneWire* bus = nullptr;
DallasTemperature* sensors = nullptr;

void actuator_io_task(void*) {
  coldflow::Driver driver;
  coldflow::Setpoint current;
  if (board::enableActuators && board::fanA >= 0 && board::fanB >= 0) {
    pinMode(board::fanA, OUTPUT); digitalWrite(board::fanA, LOW);
    pinMode(board::fanB, OUTPUT); digitalWrite(board::fanB, LOW);
    ledcSetup(0, 25000, 8); ledcSetup(1, 25000, 8);
    ledcAttachPin(board::fanA, 0); ledcAttachPin(board::fanB, 1);
    ledcWrite(0, 0); ledcWrite(1, 0);
  }
  for (;;) {
    coldflow::Setpoint received;
    if (xQueueReceive(shieldQueue, &received, 0) == pdTRUE) { current = received; driver.receive(received, millis()); }
    auto output = driver.output(millis());
    if (board::enableActuators && board::fanA >= 0 && board::fanB >= 0) { ledcWrite(0, uint32_t(output[0] * 255)); ledcWrite(1, uint32_t(output[1] * 255)); }
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { applied = output; status = current; xSemaphoreGive(inputMutex); }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void safety_task(void*) {
  uint32_t sequence = 0;
  uint32_t leaseIssued = 0;
  bool approvalWasHigh = false;
  bool tripLatched = true;
  for (;;) {
    coldflow::Input snapshot;
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { snapshot = inputs; snapshot.previous = applied; xSemaphoreGive(inputMutex); }
    snapshot.now = millis();
    snapshot.interlock = board::interlockPin >= 0 && digitalRead(board::interlockPin) == HIGH;
    const bool approvalHigh = board::approvalPin >= 0 && digitalRead(board::approvalPin) == HIGH;
    if (!snapshot.interlock) { tripLatched = true; leaseIssued = 0; }
    if (approvalHigh && !approvalWasHigh && snapshot.interlock) { tripLatched = false; leaseIssued = snapshot.now; }
    approvalWasHigh = approvalHigh;
    snapshot.interlock = snapshot.interlock && !tripLatched;
    snapshot.commissioned = board::enableActuators && board::fanA >= 0 && board::fanB >= 0;
    snapshot.leaseIssued = leaseIssued;
    snapshot.leaseDuration = leaseIssued ? 30000 : 0;
    snapshot.lastSequence = sequence;
    snapshot.sequence = sequence == UINT32_MAX ? 0 : ++sequence;
    snapshot.requested = {0.25f, 0.25f};
    const auto authorized = coldflow::authorize(snapshot);
    xQueueOverwrite(shieldQueue, &authorized);
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void acquisition_task(void*) {
  if (board::oneWirePin >= 0) { bus = new OneWire(board::oneWirePin); sensors = new DallasTemperature(bus); sensors->begin(); sensors->setResolution(12); sensors->setWaitForConversion(false); }
  for (;;) {
    coldflow::Input acquired;
    acquired.temperatures.fill(NAN);
    acquired.sensorsValid = sensors != nullptr;
    if (sensors) {
      sensors->requestTemperatures();
      vTaskDelay(pdMS_TO_TICKS(800));
      for (size_t index = 0; index < 8; index++) {
        const auto& address = board::sensorAddresses[index];
        const bool identityValid = address[0] == 0x28 && OneWire::crc8(address.data(), 7) == address[7];
        const float raw = identityValid ? sensors->getTempC(address.data()) : DEVICE_DISCONNECTED_C;
        const bool valid = identityValid && std::isfinite(raw) && raw != DEVICE_DISCONNECTED_C && raw != 85.0f;
        acquired.temperatures[index] = valid ? raw + board::offsets[index] : NAN;
        acquired.sensorsValid = acquired.sensorsValid && valid;
      }
    } else vTaskDelay(pdMS_TO_TICKS(800));
    acquired.measured = millis();
    acquired.context = coldflow::Context::Unknown;
    acquired.sourceProven = false;
    acquired.actuatorHealthy = false;
    acquired.surfaceObservable = false;
    acquired.wet = true;
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { inputs = acquired; xSemaphoreGive(inputMutex); }
  }
}

void telemetry_task(void*) {
  for (;;) {
    coldflow::Input snapshot;
    coldflow::Setpoint current;
    std::array<float, 2> output{};
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { snapshot = inputs; current = status; output = applied; xSemaphoreGive(inputMutex); }
    JsonDocument document;
    document["schema"] = "coldflow.serial.v1";
    document["evidenceClass"] = "UNCOMMISSIONED_FIRMWARE";
    document["uptimeMs"] = millis(); document["measuredMs"] = snapshot.measured;
    document["sequence"] = current.sequence; document["sensorsValid"] = snapshot.sensorsValid;
    document["reason"] = coldflow::reasonName(current.reason);
    document["context"] = "SOURCE_UNKNOWN";
    auto temperatures = document["temperaturesC"].to<JsonArray>();
    for (float value : snapshot.temperatures) { if (std::isfinite(value)) temperatures.add(value); else temperatures.add(nullptr); }
    auto fans = document["appliedFans"].to<JsonArray>(); for (float value : output) fans.add(value);
    serializeJson(document, Serial); Serial.println();
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void setup() {
  Serial.begin(115200);
  inputMutex = xSemaphoreCreateMutex(); shieldQueue = xQueueCreate(1, sizeof(coldflow::Setpoint));
  if (!inputMutex || !shieldQueue) { for (;;) delay(1000); }
  if (board::interlockPin >= 0) pinMode(board::interlockPin, INPUT_PULLDOWN);
  if (board::approvalPin >= 0) pinMode(board::approvalPin, INPUT_PULLDOWN);
  xTaskCreate(actuator_io_task, "actuator_io_task", 3072, nullptr, 6, nullptr);
  xTaskCreate(safety_task, "safety_task", 4096, nullptr, 5, nullptr);
  xTaskCreate(acquisition_task, "acquisition_task", 4096, nullptr, 2, nullptr);
  xTaskCreate(telemetry_task, "telemetry_task", 4096, nullptr, 1, nullptr);
}
void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }