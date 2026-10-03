#pragma once
#include <array>
#include <cmath>
#include <cstdint>
#include <algorithm>

namespace coldflow {
enum class Context { Normal, DoorOpen, Defrost, Drip, FanDelay, Recovery, Unknown };
enum class Reason { Approved, Stale, Sensor, Interlock, ContextInhibit, Lease, Replay, Actuator, Condensation, Range, LowLimit, Uncommissioned };
struct Input {
  uint32_t now = 0;
  uint32_t measured = 0;
  uint32_t leaseIssued = 0;
  uint32_t leaseDuration = 0;
  uint32_t sequence = 0;
  uint32_t lastSequence = 0;
  std::array<float, 8> temperatures{};
  std::array<float, 2> requested{};
  std::array<float, 2> previous{};
  Context context = Context::Unknown;
  bool sensorsValid = false;
  bool interlock = false;
  bool sourceProven = false;
  bool actuatorHealthy = false;
  bool commissioned = false;
  bool wet = true;
  bool surfaceObservable = false;
  float surfaceMinimum = NAN;
  float dewPoint = NAN;
  float uncertainty = NAN;
};
struct Setpoint {
  uint32_t sequence = 0;
  uint32_t issued = 0;
  std::array<float, 2> fans{};
  Reason reason = Reason::Uncommissioned;
  bool permitted = false;
};
inline Setpoint authorize(const Input& input) {
  Setpoint output;
  output.sequence = input.sequence;
  output.issued = input.now;
  if (!input.commissioned) output.reason = Reason::Uncommissioned;
  else if (uint32_t(input.now - input.measured) > 2000) output.reason = Reason::Stale;
  else if (!input.sensorsValid || !std::all_of(input.temperatures.begin(), input.temperatures.end(), [](float value) { return std::isfinite(value) && value > -30 && value < 60; })) output.reason = Reason::Sensor;
  else if (!input.interlock) output.reason = Reason::Interlock;
  else if (input.context != Context::Normal || !input.sourceProven) output.reason = Reason::ContextInhibit;
  else if (!input.actuatorHealthy) output.reason = Reason::Actuator;
  else if (input.leaseDuration == 0 || input.leaseDuration > 30000 || uint32_t(input.now - input.leaseIssued) >= input.leaseDuration) output.reason = Reason::Lease;
  else if (input.sequence == 0 || input.sequence <= input.lastSequence) output.reason = Reason::Replay;
  else if (input.wet || !input.surfaceObservable || !std::isfinite(input.surfaceMinimum) || !std::isfinite(input.dewPoint) || !std::isfinite(input.uncertainty) || input.uncertainty < 0 || input.surfaceMinimum - input.dewPoint < std::max(2.0f, input.uncertainty)) output.reason = Reason::Condensation;
  else if (std::any_of(input.temperatures.begin(), input.temperatures.begin() + 6, [](float value) { return value < 4; })) output.reason = Reason::LowLimit;
  else if (!std::all_of(input.requested.begin(), input.requested.end(), [](float value) { return std::isfinite(value) && value >= 0 && value <= 0.4f; }) || !std::all_of(input.previous.begin(), input.previous.end(), [](float value) { return std::isfinite(value) && value >= 0 && value <= 0.4f; })) output.reason = Reason::Range;
  else { output.reason = Reason::Approved; output.permitted = true; for (size_t index = 0; index < 2; index++) output.fans[index] = std::min(input.requested[index], input.previous[index] + 0.05f); }
  return output;
}
inline std::array<float, 2> driverAccept(const Setpoint& point, uint32_t now, uint32_t lastSequence) {
  if (!point.permitted || point.sequence <= lastSequence || uint32_t(now - point.issued) >= 200 || !std::all_of(point.fans.begin(), point.fans.end(), [](float value) { return std::isfinite(value) && value >= 0 && value <= 0.4f; })) return {0, 0};
  return point.fans;
}
class Driver {
  Setpoint active;
  std::array<float, 2> accepted{};
  uint32_t lastSequence = 0;
public:
  void receive(const Setpoint& point, uint32_t now) {
    accepted = driverAccept(point, now, lastSequence);
    active = point;
    if (point.sequence > lastSequence) lastSequence = point.sequence;
  }
  std::array<float, 2> output(uint32_t now) const {
    return uint32_t(now - active.issued) < 200 ? accepted : std::array<float, 2>{0, 0};
  }
};
inline const char* reasonName(Reason reason) {
  switch (reason) {
    case Reason::Approved: return "APPROVED_LOCAL_DIAGNOSTIC";
    case Reason::Stale: return "STALE_CRITICAL_INPUT";
    case Reason::Sensor: return "SENSOR_INVALID";
    case Reason::Interlock: return "INTERLOCK_OPEN";
    case Reason::ContextInhibit: return "CONTEXT_OR_SOURCE_UNPROVEN";
    case Reason::Lease: return "LEASE_INVALID_OR_EXPIRED";
    case Reason::Replay: return "REPLAY_OR_SEQUENCE_EXHAUSTED";
    case Reason::Actuator: return "ACTUATOR_FEEDBACK_FAULT";
    case Reason::Condensation: return "CONDENSATION_UNOBSERVABLE_OR_UNSAFE";
    case Reason::Range: return "OUT_OF_RANGE";
    case Reason::LowLimit: return "LOW_TEMPERATURE_LIMIT";
    default: return "UNCOMMISSIONED_OUTPUT_DISABLED";
  }
}
}