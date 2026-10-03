#include "../../include/hal/hal.hpp"

#include <algorithm>

namespace coldflow::hal {
uint32_t MockHal::nowMs() const { return now; }
SensorReading MockHal::read() { return reading; }
bool MockHal::interlockClosed() const { return interlock; }
bool MockHal::approvalHigh() const { return approval; }
void MockHal::initialize() { appliedDuty = {0, 0}; }
void MockHal::write(std::array<float, 2> duty) {
  requestedDuty = duty;
  // The mock is telemetry-only by design; a healthy mock never grants motion.
  appliedDuty = {0, 0};
}
bool MockHal::healthy() const { return feedback; }
uint32_t MockHal::lastSequence() const { return persistedSequence_; }
uint32_t MockHal::nextSequence() {
  issuedSequence_ = issuedSequence_ == UINT32_MAX ? 0 : issuedSequence_ + 1;
  return issuedSequence_;
}
void MockHal::remember(uint32_t sequence) {
  if (sequence > persistedSequence_) persistedSequence_ = sequence;
}
void MockHal::reboot() {
  issuedSequence_ = persistedSequence_;
  appliedDuty = {0, 0};
}
void MockHal::publish(const Input&, const Setpoint&, std::array<float, 2> applied) {
  ++telemetryCount;
  // Serial telemetry remains observable during simulated network loss, but never commands output.
  appliedDuty = {0, 0};
  (void)applied;
}
void MockHal::setSequenceForTest(uint32_t sequence) {
  issuedSequence_ = sequence;
  persistedSequence_ = sequence;
}
}
