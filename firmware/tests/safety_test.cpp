#include "../include/safety.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>

coldflow::Input validInput() {
  coldflow::Input input;
  input.now = 1000; input.measured = 1000; input.leaseIssued = 1000; input.leaseDuration = 30000;
  input.sequence = 1; input.temperatures.fill(7); input.requested = {0.25f, 0.25f};
  input.context = coldflow::Context::Normal;
  input.sensorsValid = input.interlock = input.sourceProven = input.actuatorHealthy = input.commissioned = input.surfaceObservable = true;
  input.wet = false; input.surfaceMinimum = 4; input.dewPoint = 0; input.uncertainty = 0.5;
  return input;
}

coldflow::Input vectorInput(const std::string& name) {
  auto input = validInput();
  if (name == "uncommissioned") input.commissioned = false;
  else if (name == "stale") { input.now = coldflow::generated::freshnessMs + 1000; input.measured = 0; }
  else if (name == "sensor") input.temperatures[0] = NAN;
  else if (name == "interlock") input.interlock = false;
  else if (name == "context") input.context = coldflow::Context::DoorOpen;
  else if (name == "actuator") input.actuatorHealthy = false;
  else if (name == "lease") input.now = input.leaseIssued + input.leaseDuration;
  else if (name == "replay") input.sequence = input.lastSequence = 1;
  else if (name == "condensation") input.wet = true;
  else if (name == "low-limit") input.temperatures[0] = 3;
  else if (name == "range") input.requested = {0.5f, 0.5f};
  return input;
}

int main() {
  assert(coldflow::generated::safetyVectorCount == 12);
  for (std::size_t index = 0; index < coldflow::generated::safetyVectorCount; ++index) {
    const auto& vector = coldflow::generated::safetyVectors[index];
    const auto result = coldflow::authorize(vectorInput(vector.name));
    assert(result.permitted == vector.permitted);
    assert(std::string(coldflow::reasonName(result.reason)) == vector.expectedReason);
    if (!result.permitted) assert((result.fans == std::array<float, 2>{0, 0}));
  }

  auto approved = coldflow::authorize(validInput());
  assert(approved.permitted && approved.fans[0] == coldflow::generated::slewDuty);
  assert(coldflow::driverAccept(approved, 1000, 0)[0] == coldflow::generated::slewDuty);
  assert(coldflow::driverAccept(approved, 1200, 0)[0] == 0);
  assert(coldflow::driverAccept(approved, 1000, 1)[0] == 0);

  coldflow::Driver driver;
  driver.receive(approved, 1000);
  assert(driver.output(1199)[0] == coldflow::generated::slewDuty);
  assert(driver.output(1200)[0] == 0);
  driver.receive(approved, 1100);
  assert(driver.output(1100)[0] == 0);

  auto wrap = validInput();
  wrap.sequence = 0; wrap.lastSequence = UINT32_MAX;
  assert(coldflow::authorize(wrap).reason == coldflow::Reason::Replay);
  wrap = validInput(); wrap.now = 20; wrap.measured = UINT32_MAX - 9; wrap.leaseIssued = UINT32_MAX - 19;
  assert(coldflow::authorize(wrap).permitted);
  std::cout << "PASS: generated-vector parity, fail-closed safety cases, expiry, replay, reboot-safe wrap and zero reject output\n";
}
