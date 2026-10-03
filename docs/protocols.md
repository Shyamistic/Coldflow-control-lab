# Interface Contracts v1

Implemented scope: public simulation REST, local uncommissioned serial output. Everything marked FUTURE is a specification only and conveys no integration claim.

## Device serial v1 - implemented producer

115200 baud; one UTF-8 JSON object per LF-terminated line. Keys: `schema=coldflow.serial.v1`, `evidenceClass=UNCOMMISSIONED_FIRMWARE`, monotonic `uptimeMs`, `measuredMs`, `sequence`, `sensorsValid`, eight `temperaturesC` entries (null invalid), `reason`, `context=SOURCE_UNKNOWN`, two `appliedFans` normalized duty. Stable ROM ordering required. It is telemetry-only; input is not parsed as a command. No persistence/signed chain/serial-to-dashboard adapter is claimed. Browser samples are never classified as serial measurements.

## Device MQTT v1 - FUTURE

`coldflow/v1/sites/{siteId}/devices/{deviceId}/telemetry`, `events`, `requested-command`, `command-ack` under the same prefix. Device certificate/TLS identity binds site/device; broker ACL prevents cross-device publish. Telemetry/events QoS1, no retained measured values treated as fresh; commands QoS1, retain=false, expiry<=30 s; ACK includes command ID/sequence, accepted/rejected reason, applied/readback and device monotonic age. QoS is not replay protection. Cloud command never directly maps to a driver.

## Signing/time v1 - FUTURE

Do not accept remote leases until canonical serialization, allowed fields, schema version, signature algorithm/key ID/nonce, device binding, revocation and monotonic sequence persistence are implemented/tested. Suggested envelope uses RFC8785 canonical JSON and Ed25519, but no cryptographic implementation/FTO/security certification is claimed. UTC expiry requires validated time authority; monotonic elapsed time governs local lease execution. Uncertain UTC/reboot invalidates authorization. Signature authenticity never overrides physical interlocks. Avoid hand-rolled cryptography. Current local leases are physical-button-based, not digitally signed.

## Edge gateway v1 - FUTURE

Reconnect starts observe-only; request fresh device state and latest accepted sequence. Buffered telemetry stays historical with original measurement time and quality. No buffered/replayed commands on reconnection. No retained state creates a fresh lease. Offline device safety continues. Gateway/UI cannot open driver handles. No gateway is deployed.

## PLC/analytics arbitration v1 - FUTURE

Standard PLC may supervise added separate actuators only after a verified site contract. Independent safety relay/hardwired circuit remains authoritative. Ownership token and timeout identify one local authorizer; external requests require local approval. OEM refrigeration safeguards remain untouched. No implemented Schneider driver or approved Eliwell interface exists.

## Modbus v1 - FUTURE, no installed adapter

Reserve versioned contract: input registers 0-1 protocol/version, 2 quality flags, 3-4 monotonic telemetry sequence; 10-17 eight signed temperature values scaled 0.01 C; 18-19 fan applied duty scaled 0.001. Define endian word order and signed invalid sentinel before freeze; timestamps/age, not magic numbers, determine freshness. Proposed holding registers 100-101 request duty, 102-103 command sequence, 104-105 lease age/expiry, 106 commit; ACK in separate read-only inputs. No raw holding register writes PWM. PLC locally validates identity/lease/context/range/commit and returns accepted/rejected reason plus applied feedback. These addresses are draft reservations, not a tested hardware ICD; do not wire them to equipment.

## Degraded modes

API/browser outage affects simulation only. Firmware broker/network functionality does not exist. Missing sensor/source/surface/feedback, command expiry/replay, broken interlock, boot and uncommissioned profile all disable added motion. A held approval button does not renew its lease; a new deliberate edge is required. Hardware reset/lease cannot be replaced by browser approval. OTA and authenticated multi-tenant operations are post-gate work, not implemented production features.