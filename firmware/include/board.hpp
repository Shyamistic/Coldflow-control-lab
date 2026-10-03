#pragma once
#include <array>
#include <cstdint>

namespace board {
constexpr bool enableActuators = false;
constexpr int oneWirePin = -1;
constexpr int fanA = -1;
constexpr int fanB = -1;
constexpr int interlockPin = -1;
constexpr int approvalPin = -1;
constexpr std::array<std::array<uint8_t, 8>, 8> sensorAddresses{};
constexpr std::array<float, 8> offsets{};
}