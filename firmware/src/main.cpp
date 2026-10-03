#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <OneWire.h>

#include <cmath>

#include "board.hpp"
#include "hal/hal.hpp"

SemaphoreHandle_t inputMutex;
QueueHandle_t shieldQueue;
coldflow::Input inputs;
coldflow::Setpoint status;
std::array<float, 2> applied{};

class ArduinoClock final : public coldflow::hal::Clock {
public:
  uint32_t nowMs() const override { return millis(); }
};

class ArduinoSensors final : public coldflow::hal::SensorReader {
public:
  coldflow::hal::SensorReading read() override {
    coldflow::hal::SensorReading acquired;
    acquired.temperatures.fill(NAN);
    if (bus == nullptr && board::oneWirePin >= 0) {
      bus = new OneWire(board::oneWirePin);
      sensors = new DallasTemperature(bus);
      sensors->begin();
      sensors->setResolution(12);
      sensors->setWaitForConversion(false);
    }
    acquired.valid = sensors != nullptr;
    if (sensors) {
      sensors->requestTemperatures();
      vTaskDelay(pdMS_TO_TICKS(800));
      for (size_t index = 0; index < 8; index++) {
        const auto& address = board::sensorAddresses[index];
        const bool identityValid = address[0] == 0x28 && OneWire::crc8(address.data(), 7) == address[7];
        const float raw = identityValid ? sensors->getTempC(address.data()) : DEVICE_DISCONNECTED_C;
        const bool valid = identityValid && std::isfinite(raw) && raw != DEVICE_DISCONNECTED_C && raw != 85.0f;
        acquired.temperatures[index] = valid ? raw + board::offsets[index] : NAN;
        acquired.valid = acquired.valid && valid;
      }
    } else {
      vTaskDelay(pdMS_TO_TICKS(800));
    }
    acquired.measured = millis();
    return acquired;
  }

private:
  OneWire* bus = nullptr;
  DallasTemperature* sensors = nullptr;
};

class ArduinoInterlock final : public coldflow::hal::InterlockApproval {
public:
  bool interlockClosed() const override { return board::interlockPin >= 0 && digitalRead(board::interlockPin) == HIGH; }
  bool approvalHigh() const override { return board::approvalPin >= 0 && digitalRead(board::approvalPin) == HIGH; }
};

class ArduinoPwmTach final : public coldflow::hal::PwmTachFeedback {
public:
  void initialize() override {
    if (!board::enableActuators || board::fanA < 0 || board::fanB < 0) return;
    pinMode(board::fanA, OUTPUT); digitalWrite(board::fanA, LOW);
    pinMode(board::fanB, OUTPUT); digitalWrite(board::fanB, LOW);
    ledcSetup(0, 25000, 8); ledcSetup(1, 25000, 8);
    ledcAttachPin(board::fanA, 0); ledcAttachPin(board::fanB, 1);
    ledcWrite(0, 0); ledcWrite(1, 0);
  }

  void write(std::array<float, 2> duty) override {
    if (!board::enableActuators || board::fanA < 0 || board::fanB < 0) return;
    ledcWrite(0, uint32_t(duty[0] * 255));
    ledcWrite(1, uint32_t(duty[1] * 255));
  }

  bool healthy() const override {
    // Feedback is deliberately unavailable until a qualified tach/current adapter exists.
    return false;
  }
};

class VolatileSequence final : public coldflow::hal::SequencePersistence {
public:
  uint32_t lastSequence() const override { return last; }
  uint32_t nextSequence() override { issued = issued == UINT32_MAX ? 0 : issued + 1; return issued; }
  void remember(uint32_t sequence) override { if (sequence > last) last = sequence; }
  void reboot() override { issued = last; }

private:
  uint32_t issued = 0;
  uint32_t last = 0;
};

class SerialTelemetry final : public coldflow::hal::TelemetrySink {
public:
  void publish(const coldflow::Input& input, const coldflow::Setpoint& current, std::array<float, 2> output) override {
    JsonDocument document;
    document["schema"] = "coldflow.serial.v1";
    document["evidenceClass"] = "UNCOMMISSIONED_FIRMWARE";
    document["uptimeMs"] = millis(); document["measuredMs"] = input.measured;
    document["sequence"] = current.sequence; document["sensorsValid"] = input.sensorsValid;
    document["reason"] = coldflow::reasonName(current.reason);
    document["context"] = "SOURCE_UNKNOWN";
    auto temperatures = document["temperaturesC"].to<JsonArray>();
    for (float value : input.temperatures) { if (std::isfinite(value)) temperatures.add(value); else temperatures.add(nullptr); }
    auto fans = document["appliedFans"].to<JsonArray>(); for (float value : output) fans.add(value);
    serializeJson(document, Serial); Serial.println();
  }
};

ArduinoClock clockSource;
ArduinoSensors sensorSource;
ArduinoInterlock interlockSource;
ArduinoPwmTach actuatorSource;
VolatileSequence sequenceSource;
SerialTelemetry telemetrySource;

void actuator_io_task(void*) {
  coldflow::Driver driver;
  coldflow::Setpoint current;
  actuatorSource.initialize();
  for (;;) {
    coldflow::Setpoint received;
    if (xQueueReceive(shieldQueue, &received, 0) == pdTRUE) { current = received; driver.receive(received, clockSource.nowMs()); }
    const auto output = driver.output(clockSource.nowMs());
    actuatorSource.write(output);
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { applied = output; status = current; xSemaphoreGive(inputMutex); }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void safety_task(void*) {
  uint32_t leaseIssued = 0;
  bool approvalWasHigh = false;
  bool tripLatched = true;
  for (;;) {
    coldflow::Input snapshot;
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { snapshot = inputs; snapshot.previous = applied; xSemaphoreGive(inputMutex); }
    snapshot.now = clockSource.nowMs();
    snapshot.interlock = interlockSource.interlockClosed();
    const bool approvalHigh = interlockSource.approvalHigh();
    if (!snapshot.interlock) { tripLatched = true; leaseIssued = 0; }
    if (approvalHigh && !approvalWasHigh && snapshot.interlock) { tripLatched = false; leaseIssued = snapshot.now; }
    approvalWasHigh = approvalHigh;
    snapshot.interlock = snapshot.interlock && !tripLatched;
    snapshot.commissioned = board::enableActuators && board::fanA >= 0 && board::fanB >= 0;
    snapshot.leaseIssued = leaseIssued;
    snapshot.leaseDuration = leaseIssued ? 30000 : 0;
    snapshot.lastSequence = sequenceSource.lastSequence();
    snapshot.sequence = sequenceSource.nextSequence();
    sequenceSource.remember(snapshot.sequence);
    snapshot.requested = {0.25f, 0.25f};
    const auto authorized = coldflow::authorize(snapshot);
    xQueueOverwrite(shieldQueue, &authorized);
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

void acquisition_task(void*) {
  for (;;) {
    const auto reading = sensorSource.read();
    coldflow::Input acquired;
    acquired.temperatures = reading.temperatures;
    acquired.sensorsValid = reading.valid;
    acquired.measured = reading.measured;
    acquired.context = reading.context;
    acquired.sourceProven = reading.sourceProven;
    acquired.surfaceObservable = reading.surfaceObservable;
    acquired.surfaceMinimum = reading.surfaceMinimum;
    acquired.dewPoint = reading.dewPoint;
    acquired.uncertainty = reading.uncertainty;
    acquired.wet = reading.wet;
    acquired.actuatorHealthy = actuatorSource.healthy();
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { inputs = acquired; xSemaphoreGive(inputMutex); }
  }
}

void telemetry_task(void*) {
  for (;;) {
    coldflow::Input snapshot;
    coldflow::Setpoint current;
    std::array<float, 2> output{};
    if (xSemaphoreTake(inputMutex, pdMS_TO_TICKS(2)) == pdTRUE) { snapshot = inputs; current = status; output = applied; xSemaphoreGive(inputMutex); }
    telemetrySource.publish(snapshot, current, output);
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
