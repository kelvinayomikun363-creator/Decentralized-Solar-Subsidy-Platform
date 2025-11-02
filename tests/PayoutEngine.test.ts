import { describe, it, expect, beforeEach, vi } from "vitest";

interface Installation {
  owner: string;
  capacity: bigint;
  verified: boolean;
}
interface EnergyData {
  kwh: bigint;
  timestamp: bigint;
  valid: boolean;
}

const ERR_NOT_FOUND = 100n;
const ERR_UNAUTHORIZED = 101n;
const ERR_INVALID_INSTALLATION = 102n;
const ERR_INSUFFICIENT_POOL = 103n;
const ERR_ALREADY_CLAIMED = 104n;
const ERR_INVALID_AMOUNT = 105n;
const ERR_ORACLE_FAIL = 106n;
const ERR_RATE_NOT_SET = 107n;

class PayoutEngineMock {
  state = {
    subsidyRate: 0n,
    installations: new Map<bigint, Installation>(),
    energyData: new Map<bigint, EnergyData>(),
    lastClaimed: new Map<bigint, bigint>(),
    nonce: 0n,
    stxTransfers: [] as { amount: bigint; from: string; to: string }[],
  };
  blockHeight = 1000n;
  caller = "ST1USER";
  governanceAdmin = "ST1GOV";
  installerVerifier = "ST1VERIFIER";
  oracle = "ST1ORACLE";
  contractPrincipal = "ST1PAYOUT";

  reset() {
    this.state = {
      subsidyRate: 0n,
      installations: new Map(),
      energyData: new Map(),
      lastClaimed: new Map(),
      nonce: 0n,
      stxTransfers: [],
    };
    this.blockHeight = 1000n;
    this.caller = "ST1USER";
  }

  setSubsidyRate(rate: bigint): { isOk: boolean; value?: boolean | bigint } {
    if (this.caller !== this.governanceAdmin)
      return { isOk: false, value: ERR_UNAUTHORIZED };
    if (rate === 0n) return { isOk: false, value: ERR_INVALID_AMOUNT };
    this.state.subsidyRate = rate;
    return { isOk: true, value: true };
  }

  registerInstallation(
    id: bigint,
    capacity: bigint
  ): { isOk: boolean; value?: boolean | bigint } {
    if (capacity === 0n) return { isOk: false, value: ERR_INVALID_AMOUNT };
    this.state.installations.set(id, {
      owner: this.caller,
      capacity,
      verified: false,
    });
    return { isOk: true, value: true };
  }

  verifyInstallation(id: bigint): { isOk: boolean; value?: boolean | bigint } {
    if (this.caller !== this.installerVerifier)
      return { isOk: false, value: ERR_UNAUTHORIZED };
    const inst = this.state.installations.get(id);
    if (!inst) return { isOk: false, value: ERR_NOT_FOUND };
    this.state.installations.set(id, { ...inst, verified: true });
    return { isOk: true, value: true };
  }

  submitEnergyData(
    id: bigint,
    kwh: bigint,
    timestamp: bigint
  ): { isOk: boolean; value?: bigint } {
    if (this.caller !== this.oracle)
      return { isOk: false, value: ERR_UNAUTHORIZED };
    if (kwh === 0n || timestamp < this.blockHeight)
      return { isOk: false, value: ERR_INVALID_AMOUNT };
    this.state.energyData.set(id, { kwh, timestamp, valid: true });
    const nonce = this.state.nonce;
    this.state.nonce += 1n;
    return { isOk: true, value: nonce };
  }

  claimSubsidy(installationId: bigint): { isOk: boolean; value?: bigint } {
    const inst = this.state.installations.get(installationId);
    if (!inst) return { isOk: false, value: ERR_NOT_FOUND };
    const energy = this.state.energyData.get(installationId);
    if (!energy || !energy.valid)
      return { isOk: false, value: ERR_ORACLE_FAIL };
    if (!inst.verified) return { isOk: false, value: ERR_INVALID_INSTALLATION };
    if (this.state.subsidyRate === 0n)
      return { isOk: false, value: ERR_RATE_NOT_SET };
    const last = this.state.lastClaimed.get(installationId) ?? 0n;
    if (energy.timestamp <= last)
      return { isOk: false, value: ERR_ALREADY_CLAIMED };
    const payout = energy.kwh * this.state.subsidyRate;
    if (payout > 1000000000n)
      return { isOk: false, value: ERR_INSUFFICIENT_POOL };
    this.state.stxTransfers.push({
      amount: payout,
      from: this.contractPrincipal,
      to: inst.owner,
    });
    this.state.lastClaimed.set(installationId, energy.timestamp);
    return { isOk: true, value: payout };
  }
}

describe("PayoutEngine", () => {
  let engine: PayoutEngineMock;

  beforeEach(() => {
    engine = new PayoutEngineMock();
    engine.reset();
  });

  it("sets subsidy rate by governance admin", () => {
    engine.caller = engine.governanceAdmin;
    const result = engine.setSubsidyRate(50n);
    expect(result.isOk).toBe(true);
    expect(result.value).toBe(true);
    expect(engine.state.subsidyRate).toBe(50n);
  });

  it("rejects subsidy rate set by non-admin", () => {
    const result = engine.setSubsidyRate(50n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("registers installation successfully", () => {
    const result = engine.registerInstallation(1n, 5000n);
    expect(result.isOk).toBe(true);
    const inst = engine.state.installations.get(1n);
    expect(inst).toEqual({
      owner: "ST1USER",
      capacity: 5000n,
      verified: false,
    });
  });

  it("verifies installation by authorized verifier", () => {
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.installerVerifier;
    const result = engine.verifyInstallation(1n);
    expect(result.isOk).toBe(true);
    const inst = engine.state.installations.get(1n);
    expect(inst?.verified).toBe(true);
  });

  it("submits energy data via oracle", () => {
    engine.caller = engine.oracle;
    const result = engine.submitEnergyData(1n, 250n, 1005n);
    expect(result.isOk).toBe(true);
    expect(result.value).toBe(0n);
    const data = engine.state.energyData.get(1n);
    expect(data).toEqual({ kwh: 250n, timestamp: 1005n, valid: true });
  });

  it("claims subsidy after verification and data", () => {
    engine.caller = engine.governanceAdmin;
    engine.setSubsidyRate(50n);
    engine.caller = "ST1USER";
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.installerVerifier;
    engine.verifyInstallation(1n);
    engine.caller = engine.oracle;
    engine.submitEnergyData(1n, 250n, 1005n);
    engine.caller = "ST1USER";
    const result = engine.claimSubsidy(1n);
    expect(result.isOk).toBe(true);
    expect(result.value).toBe(12500n);
    expect(engine.state.stxTransfers).toEqual([
      { amount: 12500n, from: "ST1PAYOUT", to: "ST1USER" },
    ]);
  });

  it("prevents double claim", () => {
    engine.caller = engine.governanceAdmin;
    engine.setSubsidyRate(50n);
    engine.caller = "ST1USER";
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.installerVerifier;
    engine.verifyInstallation(1n);
    engine.caller = engine.oracle;
    engine.submitEnergyData(1n, 250n, 1005n);
    engine.caller = "ST1USER";
    engine.claimSubsidy(1n);
    const result = engine.claimSubsidy(1n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_CLAIMED);
  });

  it("rejects claim without verified installation", () => {
    engine.caller = engine.governanceAdmin;
    engine.setSubsidyRate(50n);
    engine.caller = "ST1USER";
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.oracle;
    engine.submitEnergyData(1n, 250n, 1005n);
    engine.caller = "ST1USER";
    const result = engine.claimSubsidy(1n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(ERR_INVALID_INSTALLATION);
  });

  it("rejects claim without energy data", () => {
    engine.caller = engine.governanceAdmin;
    engine.setSubsidyRate(50n);
    engine.caller = "ST1USER";
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.installerVerifier;
    engine.verifyInstallation(1n);
    engine.caller = "ST1USER";
    const result = engine.claimSubsidy(1n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_FAIL);
  });

  it("rejects claim with insufficient pool balance", () => {
    engine.caller = engine.governanceAdmin;
    engine.setSubsidyRate(10000000n);
    engine.caller = "ST1USER";
    engine.registerInstallation(1n, 5000n);
    engine.caller = engine.installerVerifier;
    engine.verifyInstallation(1n);
    engine.caller = engine.oracle;
    engine.submitEnergyData(1n, 1000n, 1005n);
    engine.caller = "ST1USER";
    const result = engine.claimSubsidy(1n);
    expect(result.isOk).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_POOL);
  });
});
