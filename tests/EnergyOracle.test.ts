import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 300n;
const ERR_INVALID_INSTALLATION = 301n;
const ERR_INVALID_KWH = 302n;
const ERR_ALREADY_REPORTED = 303n;
const ERR_ORACLE_NOT_SET = 304n;
const ERR_BLOCK_TOO_OLD = 305n;
const ERR_SIGNATURE_VERIFICATION_FAILED = 306n;
const ERR_INVALID_SIGNER = 307n;

interface EnergyReport {
  kwhProduced: bigint;
  reportedAt: bigint;
  reporter: string;
  signature: Buffer;
  verified: boolean;
}

class EnergyOracleMock {
  state: {
    oraclePrincipal: string;
    admin: string;
    isPaused: boolean;
    lastReportBlock: bigint;
    totalReports: bigint;
    energyReports: Map<string, EnergyReport>;
    installationCapacities: Map<bigint, bigint>;
    oracleSigners: Set<string>;
    payoutEngineCalled: boolean;
  };
  caller: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      oraclePrincipal: "ST1ORACLE",
      admin: "ST1ADMIN",
      isPaused: false,
      lastReportBlock: 0n,
      totalReports: 0n,
      energyReports: new Map(),
      installationCapacities: new Map(),
      oracleSigners: new Set(["ST1SIGNER"]),
      payoutEngineCalled: false,
    };
    this.caller = "ST1SIGNER";
    this.blockHeight = 1000n;
  }

  setOraclePrincipal(newOracle: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.oraclePrincipal = newOracle;
    return { ok: true, value: true };
  }

  addOracleSigner(signer: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.oraclePrincipal)
      return { ok: false, value: false };
    this.state.oracleSigners.add(signer);
    return { ok: true, value: true };
  }

  pauseOracle(): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  registerCapacity(
    installationId: bigint,
    capacityKw: bigint
  ): { ok: boolean; value: boolean } {
    this.state.installationCapacities.set(installationId, capacityKw);
    return { ok: true, value: true };
  }

  submitReport(
    installationId: bigint,
    targetBlock: bigint,
    kwhProducedMicro: bigint,
    signature: Buffer
  ): { ok: boolean; value: boolean } {
    if (this.state.isPaused) return { ok: false, value: false };
    if (!this.state.oracleSigners.has(this.caller))
      return { ok: false, value: ERR_INVALID_SIGNER };

    const hoursSince = this.blockHeight - targetBlock;
    if (hoursSince <= 0 || hoursSince > 144n)
      return { ok: false, value: ERR_BLOCK_TOO_OLD };

    const key = `${installationId}-${targetBlock}`;
    if (this.state.energyReports.has(key))
      return { ok: false, value: ERR_ALREADY_REPORTED };

    const capacity = this.state.installationCapacities.get(installationId);
    if (!capacity) return { ok: false, value: ERR_INVALID_INSTALLATION };

    const maxKwhMicro = capacity * 6n * hoursSince * 1000000n;
    if (kwhProducedMicro > maxKwhMicro)
      return { ok: false, value: ERR_INVALID_KWH };

    const kwh = kwhProducedMicro / 1000000n;
    this.state.energyReports.set(key, {
      kwhProduced: kwh,
      reportedAt: this.blockHeight,
      reporter: this.caller,
      signature,
      verified: true,
    });
    this.state.totalReports += 1n;
    this.state.lastReportBlock = this.blockHeight;
    this.state.payoutEngineCalled = true;

    return { ok: true, value: true };
  }

  getReport(installationId: bigint, blockHeight: bigint): EnergyReport | null {
    return (
      this.state.energyReports.get(`${installationId}-${blockHeight}`) || null
    );
  }
}

describe("EnergyOracle", () => {
  let oracle: EnergyOracleMock;

  beforeEach(() => {
    oracle = new EnergyOracleMock();
    oracle.reset();
    oracle.blockHeight = 1000n;
  });

  it("registers capacity from InstallationRegistry", () => {
    oracle.caller = "ST1REGISTRY";
    const result = oracle.registerCapacity(1n, 10n);
    expect(result.ok).toBe(true);
    expect(oracle.state.installationCapacities.get(1n)).toBe(10n);
  });

  it("allows admin to set oracle principal", () => {
    oracle.caller = "ST1ADMIN";
    const result = oracle.setOraclePrincipal("ST2ORACLE");
    expect(result.ok).toBe(true);
    expect(oracle.state.oraclePrincipal).toBe("ST2ORACLE");
  });

  it("allows oracle to add signers", () => {
    oracle.caller = "ST1ORACLE";
    const result = oracle.addOracleSigner("ST2SIGNER");
    expect(result.ok).toBe(true);
    expect(oracle.state.oracleSigners.has("ST2SIGNER")).toBe(true);
  });

  it("rejects report from non-signer", () => {
    oracle.caller = "ST1HACKER";
    oracle.registerCapacity(1n, 10n);
    const result = oracle.submitReport(1n, 990n, 50000000n, Buffer.alloc(65));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SIGNER);
  });

  it("accepts valid report within 24h window", () => {
    oracle.registerCapacity(1n, 10n);
    oracle.blockHeight = 1000n;
    const result = oracle.submitReport(1n, 990n, 50000000n, Buffer.alloc(65)); // 50 kWh over 10h
    expect(result.ok).toBe(true);
    const report = oracle.getReport(1n, 990n);
    expect(report?.kwhProduced).toBe(50n);
  });

  it("rejects report older than 24h", () => {
    oracle.registerCapacity(1n, 10n);
    oracle.blockHeight = 1200n;
    const result = oracle.submitReport(1n, 1000n, 10000000n, Buffer.alloc(65));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BLOCK_TOO_OLD);
  });

  it("enforces max kWh based on capacity", () => {
    oracle.registerCapacity(1n, 5n);
    oracle.blockHeight = 1000n;
    const result = oracle.submitReport(1n, 990n, 400000000n, Buffer.alloc(65)); // 400 kWh > 5kW * 6 * 10h
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_KWH);
  });

  it("prevents double reporting for same block", () => {
    oracle.registerCapacity(1n, 10n);
    oracle.blockHeight = 1000n;
    oracle.submitReport(1n, 990n, 30000000n, Buffer.alloc(65));
    const result2 = oracle.submitReport(1n, 990n, 20000000n, Buffer.alloc(65));
    expect(result2.ok).toBe(false);
    expect(result2.value).toBe(ERR_ALREADY_REPORTED);
  });

  it("tracks total reports", () => {
    oracle.registerCapacity(1n, 10n);
    oracle.registerCapacity(2n, 15n);
    oracle.submitReport(1n, 990n, 20000000n, Buffer.alloc(65));
    oracle.submitReport(2n, 995n, 30000000n, Buffer.alloc(65));
    expect(oracle.state.totalReports).toBe(2n);
  });
});
