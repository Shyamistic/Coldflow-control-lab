#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "../safety.hpp"

namespace coldflow::hal {
struct SensorReading {
  std::array<float, 8> temperatures{};
  uint32_t measured = 0;
  bool valid = false;
  Context context = Context::Unknown;
  bool sourceProven = false;
  bool wet = true;
  bool surfaceObservable = false;
  float surfaceMinimum = NAN;
  float dewPoint = NAN;
  float uncertainty = NAN;
};

class Clock {
public:
  virtual ~Clock() = default;
  virtual uint32_t nowMs() const = 0;
};

class SensorReader {
public:
  virtual ~SensorReader() = default;
  virtual SensorReading read() = 0;
};

class InterlockApproval {
public:
  virtual ~InterlockApproval() = default;
  virtual bool interlockClosed() const = 0;
  virtual bool approvalHigh() const = 0;
};

class PwmTachFeedback {
public:
  virtual ~PwmTachFeedback() = default;
  virtual void initialize() = 0;
  virtual void write(std::array<float, 2> duty) = 0;
  virtual bool healthy() const = 0;
};

class SequencePersistence {
public:
  virtual ~SequencePersistence() = default;
  virtual uint32_t lastSequence() const = 0;
  virtual uint32_t nextSequence() = 0;
  virtual void remember(uint32_t sequence) = 0;
  virtual void reboot() = 0;
};

class TelemetrySink {
public:
  virtual ~TelemetrySink() = default;
  virtual void publish(const Input& input, const Setpoint& setpoint, std::array<float, 2> applied) = 0;
};

class MockHal final : public Clock, public SensorReader, public InterlockApproval, public PwmTachFeedback, public SequencePersistence, public TelemetrySink {
public:
  uint32_t now = 0;
  SensorReading reading;
  bool interlock = false;
  bool approval = false;
  bool feedback = false;
  bool networkAvailable = true;
  std::array<float, 2> requestedDuty{};
  std::array<float, 2> appliedDuty{};
  std::size_t telemetryCount = 0;

  uint32_t nowMs() const override;
  SensorReading read() override;
  bool interlockClosed() const override;
  bool approvalHigh() const override;
  void initialize() override;
  void write(std::array<float, 2> duty) override;
  bool healthy() const override;
  uint32_t lastSequence() const override;
  uint32_t nextSequence() override;
  void remember(uint32_t sequence) override;
  void reboot() override;
  void publish(const Input& input, const Setpoint& setpoint, std::array<float, 2> applied) override;
  void setSequenceForTest(uint32_t sequence);

private:
  uint32_t issuedSequence_ = 0;
  uint32_t persistedSequence_ = 0;
};
}
