#include "../include/safety.hpp"
#include <cassert>
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
int main() {
  auto input = validInput(); auto point = coldflow::authorize(input);
  assert(point.permitted && point.fans[0] == 0.05f);
  assert(coldflow::generated::safetyVectorCount == 12);
  assert(std::string(coldflow::reasonName(point.reason)) == coldflow::generated::safetyVectors[0].expectedReason);
  input.commissioned = false;
  assert(std::string(coldflow::reasonName(coldflow::authorize(input).reason)) == coldflow::generated::safetyVectors[1].expectedReason);
  for (auto context : {coldflow::Context::DoorOpen, coldflow::Context::Defrost, coldflow::Context::Drip, coldflow::Context::FanDelay, coldflow::Context::Recovery, coldflow::Context::Unknown}) { input = validInput(); input.context = context; assert(!coldflow::authorize(input).permitted); }
  input = validInput(); input.commissioned = false; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.now = 31000; input.measured = 31000; assert(coldflow::authorize(input).reason == coldflow::Reason::Lease);
  input = validInput(); input.interlock = false; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.surfaceObservable = false; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.surfaceMinimum = 1; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.wet = true; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.measured = uint32_t(-3000); assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.temperatures[0] = NAN; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.temperatures[0] = 3; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.sequence = input.lastSequence = 1; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.actuatorHealthy = false; assert(!coldflow::authorize(input).permitted);
  input = validInput(); input.requested[0] = 1; assert(!coldflow::authorize(input).permitted);
  point = coldflow::authorize(validInput());
  assert(coldflow::driverAccept(point, 1000, 0)[0] == 0.05f);
  assert(coldflow::driverAccept(point, 1200, 0)[0] == 0);
  assert(coldflow::driverAccept(point, 1000, 1)[0] == 0);
  coldflow::Driver driver;
  driver.receive(point, 1000);
  assert(driver.output(1100)[0] == 0.05f);
  assert(driver.output(1199)[0] == 0.05f);
  assert(driver.output(1200)[0] == 0);
  driver.receive(point, 1100);
  assert(driver.output(1100)[0] == 0);
  input = validInput(); input.now = 20; input.measured = uint32_t(-10); input.leaseIssued = uint32_t(-20); assert(coldflow::authorize(input).permitted);
  std::cout << "PASS: native firmware safety cases, latched driver, expiry, replay and wrap-safe elapsed time\n";
}