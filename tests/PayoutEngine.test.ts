import { describe, it, expect, beforeEach } from "vitest";
import {
  Cl,
  ClarityType,
  cvToValue,
  uintCV,
  someCV,
  noneCV,
  tupleCV,
  boolCV,
} from "@stacks/transactions";

interface Installation {
  owner: string;
  capacityKw: bigint;
  registeredAt: bigint;
  verified: boolean;
  lastClaimedOutput: bigint;
}

interface ClaimedOutput {
  installationId: bigint;
  block: bigint;
}

interface EnergyOutput {
  installationId: bigint;
  block: bigint;
  kwh: bigint;
}

class PayoutEngineMock {
  state: {
    subsidyRatePerKwh: bigint;
    totalSubsidizedKwh: bigint;
    lastClaimBlock: bigint;
    installations: Map<bigint, Installation>;
    claimedOutputs: Map<string, boolean>;
    energyOutputs: Map<string, bigint>;
    poolBalance: bigint;
    governanceAdmin: string;
    oracle: string;
    installationRegistryNextId: bigint;
  };
  caller: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      subsidyRatePerKwh: 0n,
      totalSubsidizedKwh: 0n,
      lastClaimBlock: 0n,
      installations: new Map(),
      claimedOutputs: new Map(),
      energyOutputs: new Map(),
      poolBalance: 1000000n * 1000000n,
      governanceAdmin: "ST1ADMIN",
      oracle: "ST1ORACLE",
      installationRegistryNextId: 1n,
    };
    this.caller = "ST1HOMEOWNER";
    this.blockHeight = 100n;
  }

  setSubsidyRate(newRate: bigint): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.governanceAdmin)
      return { ok: false, value: false };
    if (newRate <= 0n) return { ok: false, value: false };
    this.state.subsidyRatePerKwh = newRate;
    return { ok: true, value: true };
  }

  registerInstallation(capacityKw: bigint): { ok: boolean; value: bigint } {
    const id = this.state.installationRegistryNextId;
    this.state.installations.set(id, {
      owner: this.caller,
      capacityKw,
      registeredAt: this.blockHeight,
      verified: false,
      lastClaimedOutput: 0n,
    });
    this.state.installationRegistryNextId += 1n;
    return { ok: true, value: id };
  }

  submitOracleOutput(
    installationId: bigint,
    kwhProduced: bigint
  ): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.oracle) return { ok: false, value: false };
    const key = `${installationId}-${this.blockHeight}`;
    this.state.energyOutputs.set(key, kwhProduced);
    return { ok: true, value: true };
  }

  claimSubsidy(installationId: bigint): { ok: boolean; value: bigint } {
    const inst = this.state.installations.get(installationId);
    if (!inst) return { ok: false, value: 100n };
    if (inst.owner !== this.caller) return { ok: false, value: 101n };

    const prevKey = `${installationId}-${this.blockHeight - 1n}`;
    const currentOutput = this.state.energyOutputs.get(prevKey) || 0n;
    const newOutput =
      currentOutput > inst.lastClaimedOutput
        ? currentOutput - inst.lastClaimedOutput
        : 0n;
    if (newOutput <= 0n) return { ok: false, value: 103n };

    const claimedKey = `${installationId}-${this.blockHeight - 1n}`;
    if (this.state.claimedOutputs.get(claimedKey))
      return { ok: false, value: 102n };

    if (this.state.subsidyRatePerKwh === 0n) return { ok: false, value: 106n };

    const payout = newOutput * this.state.subsidyRatePerKwh;
    if (payout > this.state.poolBalance) return { ok: false, value: 104n };

    this.state.poolBalance -= payout;
    this.state.claimedOutputs.set(claimedKey, true);
    this.state.installations.set(installationId, {
      ...inst,
      lastClaimedOutput: currentOutput,
      verified: true,
    });
    this.state.totalSubsidizedKwh += newOutput;

    return { ok: true, value: payout };
  }

  getInstallation(id: bigint): Installation | null {
    return this.state.installations.get(id) || null;
  }

  getSubsidyRate(): bigint {
    return this.state.subsidyRatePerKwh;
  }

  getTotalSubsidized(): bigint {
    return this.state.totalSubsidizedKwh;
  }
}

describe("PayoutEngine", () => {
  let engine: PayoutEngineMock;

  beforeEach(() => {
    engine = new PayoutEngineMock();
    engine.reset();
    engine.blockHeight = 100n;
  });

  it("sets subsidy rate successfully", () => {
    engine.caller = "ST1ADMIN";
    const result = engine.setSubsidyRate(500n);
    expect(result.ok).toBe(true);
    expect(engine.getSubsidyRate()).toBe(500n);
  });

  it("rejects rate set by non-admin", () => {
    engine.caller = "ST1HACKER";
    const result = engine.setSubsidyRate(500n);
    expect(result.ok).toBe(false);
  });

  it("registers installation and gets ID", () => {
    const result = engine.registerInstallation(10n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
    const inst = engine.getInstallation(1n);
    expect(inst?.owner).toBe("ST1HOMEOWNER");
    expect(inst?.capacityKw).toBe(10n);
  });

  it("submits oracle data successfully", () => {
    engine.registerInstallation(10n);
    engine.caller = "ST1ORACLE";
    engine.blockHeight = 101n;
    const result = engine.submitOracleOutput(1n, 150n);
    expect(result.ok).toBe(true);
  });

  it("claims subsidy after output submission", () => {
    engine.caller = "ST1ADMIN";
    engine.setSubsidyRate(1000n);
    engine.caller = "ST1HOMEOWNER";
    engine.registerInstallation(10n);
    engine.caller = "ST1ORACLE";
    engine.blockHeight = 101n;
    engine.submitOracleOutput(1n, 200n);
    engine.blockHeight = 102n;
    engine.caller = "ST1HOMEOWNER";
    const result = engine.claimSubsidy(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(200000n);
    expect(engine.getTotalSubsidized()).toBe(200n);
  });

  it("rejects claim with no new output", () => {
    engine.caller = "ST1ADMIN";
    engine.setSubsidyRate(1000n);
    engine.caller = "ST1HOMEOWNER";
    engine.registerInstallation(10n);
    engine.caller = "ST1ORACLE";
    engine.blockHeight = 101n;
    engine.submitOracleOutput(1n, 100n);
    engine.blockHeight = 102n;
    engine.caller = "ST1HOMEOWNER";
    engine.claimSubsidy(1n);
    engine.blockHeight = 103n;
    engine.caller = "ST1ORACLE";
    engine.submitOracleOutput(1n, 100n);
    engine.blockHeight = 104n;
    engine.caller = "ST1HOMEOWNER";
    const result = engine.claimSubsidy(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(103n);
  });

  it("verifies installation after first claim", () => {
    engine.caller = "ST1ADMIN";
    engine.setSubsidyRate(1000n);
    engine.caller = "ST1HOMEOWNER";
    engine.registerInstallation(10n);
    engine.caller = "ST1ORACLE";
    engine.blockHeight = 101n;
    engine.submitOracleOutput(1n, 200n);
    engine.blockHeight = 102n;
    engine.caller = "ST1HOMEOWNER";
    engine.claimSubsidy(1n);
    const inst = engine.getInstallation(1n);
    expect(inst?.verified).toBe(true);
  });
});
