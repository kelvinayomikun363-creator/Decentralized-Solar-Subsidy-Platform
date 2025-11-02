import { describe, it, expect, beforeEach } from "vitest";
import { uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 200n;
const ERR_POOL_FROZEN = 201n;
const ERR_INSUFFICIENT_BALANCE = 202n;
const ERR_INVALID_AMOUNT = 203n;
const ERR_NOT_DEPLOYER = 204n;
const ERR_GOVERNANCE_NOT_APPROVED = 205n;
const ERR_INVALID_RECIPIENT = 206n;
const ERR_TRANSFER_FAILED = 207n;

interface DepositInfo {
  amount: bigint;
  depositedAt: bigint;
  lastWithdrawal: bigint;
}

interface WithdrawalInfo {
  totalWithdrawn: bigint;
  lastWithdrawalBlock: bigint;
}

class SubsidyPoolMock {
  state: {
    poolBalance: bigint;
    totalDeposited: bigint;
    totalWithdrawn: bigint;
    isFrozen: boolean;
    emergencyFreezeBlock: bigint | null;
    governanceContract: string;
    deployer: string;
    deposits: Map<string, DepositInfo>;
    withdrawals: Map<string, WithdrawalInfo>;
  };
  caller: string;
  blockHeight: bigint;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      poolBalance: 0n,
      totalDeposited: 0n,
      totalWithdrawn: 0n,
      isFrozen: false,
      emergencyFreezeBlock: null,
      governanceContract: "ST1GOVERNANCE",
      deployer: "ST1DEPLOYER",
      deposits: new Map(),
      withdrawals: new Map(),
    };
    this.caller = "ST1DEPOSITOR";
    this.blockHeight = 100n;
  }

  isPoolFrozen(): boolean {
    if (this.state.isFrozen) return true;
    if (this.state.emergencyFreezeBlock !== null) {
      return this.blockHeight <= this.state.emergencyFreezeBlock + 1440n;
    }
    return false;
  }

  canWithdrawFromPool(amount: bigint): boolean {
    const maxWithdraw = (this.state.poolBalance * 50000000n) / 100000000n;
    return (
      amount <= maxWithdraw &&
      amount <= this.state.poolBalance &&
      !this.isPoolFrozen()
    );
  }

  deposit(amount: bigint): { ok: boolean; value: bigint } {
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (this.isPoolFrozen()) return { ok: false, value: ERR_POOL_FROZEN };

    const existing = this.state.deposits.get(this.caller);
    if (existing) {
      const newAmount = existing.amount + amount;
      this.state.deposits.set(this.caller, {
        ...existing,
        amount: newAmount,
      });
    } else {
      this.state.deposits.set(this.caller, {
        amount,
        depositedAt: this.blockHeight,
        lastWithdrawal: 0n,
      });
    }
    this.state.totalDeposited += amount;
    this.state.poolBalance += amount;
    return { ok: true, value: amount };
  }

  withdrawDeposit(amount: bigint): { ok: boolean; value: bigint } {
    const deposit = this.state.deposits.get(this.caller);
    if (!deposit || amount > deposit.amount)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (this.isPoolFrozen()) return { ok: false, value: ERR_POOL_FROZEN };

    const newDeposit = deposit.amount - amount;
    this.state.deposits.set(this.caller, {
      ...deposit,
      amount: newDeposit,
      lastWithdrawal: this.blockHeight,
    });

    const withdrawal = this.state.withdrawals.get(this.caller);
    if (withdrawal) {
      this.state.withdrawals.set(this.caller, {
        ...withdrawal,
        totalWithdrawn: withdrawal.totalWithdrawn + amount,
        lastWithdrawalBlock: this.blockHeight,
      });
    } else {
      this.state.withdrawals.set(this.caller, {
        totalWithdrawn: amount,
        lastWithdrawalBlock: this.blockHeight,
      });
    }
    this.state.totalWithdrawn += amount;
    this.state.poolBalance -= amount;
    return { ok: true, value: amount };
  }

  transferToPayout(
    amount: bigint,
    installationId: bigint
  ): { ok: boolean; value: bigint } {
    if (!this.canWithdrawFromPool(amount))
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.poolBalance -= amount;
    return { ok: true, value: amount };
  }

  emergencyFreeze(): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.governanceContract)
      return { ok: false, value: false };
    if (this.state.emergencyFreezeBlock !== null)
      return { ok: false, value: false };
    this.state.emergencyFreezeBlock = this.blockHeight;
    return { ok: true, value: true };
  }

  getPoolBalance(): bigint {
    return this.state.poolBalance;
  }
}

describe("SubsidyPool", () => {
  let pool: SubsidyPoolMock;

  beforeEach(() => {
    pool = new SubsidyPoolMock();
    pool.reset();
  });

  it("deposits funds successfully", () => {
    const result = pool.deposit(1000000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000000n);
    expect(pool.getPoolBalance()).toBe(1000000n);
    expect(pool.state.totalDeposited).toBe(1000000n);
  });

  it("tracks multiple deposits from same address", () => {
    pool.deposit(1000000n);
    pool.deposit(500000n);
    const depositInfo = pool.state.deposits.get("ST1DEPOSITOR");
    expect(depositInfo?.amount).toBe(1500000n);
  });

  it("withdraws deposits successfully", () => {
    pool.deposit(2000000n);
    const result = pool.withdrawDeposit(1000000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000000n);
    expect(pool.getPoolBalance()).toBe(1000000n);
    expect(pool.state.totalWithdrawn).toBe(1000000n);
  });

  it("prevents withdrawal more than deposited", () => {
    pool.deposit(1000000n);
    const result = pool.withdrawDeposit(1500000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("enforces 50% max withdrawal limit", () => {
    pool.deposit(10000000n);
    pool.caller = "ST1GOVERNANCE";
    const result = pool.transferToPayout(6000000n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("rejects deposits when frozen", () => {
    pool.state.isFrozen = true;
    const result = pool.deposit(1000000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_FROZEN);
  });

  it("rejects withdrawals when frozen", () => {
    pool.deposit(1000000n);
    pool.state.isFrozen = true;
    const result = pool.withdrawDeposit(500000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_FROZEN);
  });

  it("only governance can freeze", () => {
    pool.caller = "ST1HACKER";
    const result = pool.emergencyFreeze();
    expect(result.ok).toBe(false);
  });

  it("rejects zero deposits", () => {
    const result = pool.deposit(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });
});
