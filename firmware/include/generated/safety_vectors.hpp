#pragma once
#include <cstddef>
#include <cstdint>

namespace coldflow::generated {
inline constexpr char schemaVersion[] = "1.0";
inline constexpr uint32_t freshnessMs = 2000;
inline constexpr uint32_t leaseMs = 30000;
inline constexpr uint32_t shieldMs = 200;
inline constexpr float maximumDuty = 0.4f;
inline constexpr float slewDuty = 0.05f;
inline constexpr float lowTemperatureC = 4.0f;
struct SafetyVector { const char* name; const char* expectedReason; bool permitted; };
inline constexpr SafetyVector safetyVectors[] = {
  {"approved", "APPROVED_LOCAL_DIAGNOSTIC", true},
  {"uncommissioned", "UNCOMMISSIONED_OUTPUT_DISABLED", false},
  {"stale", "STALE_CRITICAL_INPUT", false},
  {"sensor", "SENSOR_INVALID", false},
  {"interlock", "INTERLOCK_OPEN", false},
  {"context", "CONTEXT_OR_SOURCE_UNPROVEN", false},
  {"actuator", "ACTUATOR_FEEDBACK_FAULT", false},
  {"lease", "LEASE_INVALID_OR_EXPIRED", false},
  {"replay", "REPLAY_OR_SEQUENCE_EXHAUSTED", false},
  {"condensation", "CONDENSATION_UNOBSERVABLE_OR_UNSAFE", false},
  {"low-limit", "LOW_TEMPERATURE_LIMIT", false},
  {"range", "OUT_OF_RANGE", false}
};
inline constexpr std::size_t safetyVectorCount = sizeof(safetyVectors) / sizeof(safetyVectors[0]);
}
