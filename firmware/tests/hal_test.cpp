#include "../src/hal/mock.cpp"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>

coldflow::Input validInput() {
  coldflow::Input input;
  input.now = 1000; input.measured = 1000; input.leaseIssued = 1000; input.leaseDuration = 30000;
  input.sequence = 1; input.temperatures.fill(7); input.requested = {0.25f, 0.25f};
  input.context = coldflow::Context::Normal;
  input.sensorsValid = input.interlock = input.sourceProven = input.actuatorHealthy = input.commissioned = input.surfaceObservable = true;
  input.wet = false; input.surfaceMinimum = 4; input.dewPoint = 0; input.uncertainty = 0.5;
  return input;
}

int main() {
  coldflow::hal::MockHal hal;
  hal.initialize();
  hal.write({0.25f, 0.25f});
  assert(hal.requestedDuty[0] == 0.25f);
  assert((hal.appliedDuty == std::array<float, 2>{0, 0}));

  hal.reading.valid = false;
  assert(!hal.read().valid);
  hal.reading.valid = true;
  hal.interlock = true;
  hal.feedback = true;
  assert(hal.interlockClosed() && hal.healthy());
  hal.interlock = false;
  assert(!hal.interlockClosed());

  auto input = validInput();
  input.sensorsValid = hal.reading.valid;
  input.interlock = hal.interlockClosed();
  assert(coldflow::authorize(input).reason == coldflow::Reason::Interlock);
  input.interlock = true;
  hal.feedback = false;
  input.actuatorHealthy = hal.healthy();
  assert(coldflow::authorize(input).reason == coldflow::Reason::Actuator);

  hal.setSequenceForTest(UINT32_MAX);
  assert(hal.nextSequence() == 0);
  hal.remember(0);
  assert(hal.lastSequence() == UINT32_MAX);
  hal.reboot();
  assert((hal.appliedDuty == std::array<float, 2>{0, 0}));
  assert(hal.lastSequence() == UINT32_MAX);

  hal.networkAvailable = false;
  hal.publish(input, {}, {0.4f, 0.4f});
  assert(hal.telemetryCount == 1);
  assert((hal.appliedDuty == std::array<float, 2>{0, 0}));

  input = validInput();
  input.commissioned = false;
  assert(!coldflow::authorize(input).permitted);
  std::cout << "PASS: HAL mock fail-closed output, sensor/interlock/feedback, reboot, sequence wrap and telemetry-only network loss\n";
}
