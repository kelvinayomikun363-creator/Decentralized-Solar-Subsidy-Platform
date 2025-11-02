;; SubsidyPool.clar
(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-POOL-FROZEN u201)
(define-constant ERR-INSUFFICIENT-BALANCE u202)
(define-constant ERR-INVALID-AMOUNT u203)
(define-constant ERR-NOT-DEPLOYER u204)
(define-constant ERR-GOVERNANCE-NOT-APPROVED u205)
(define-constant ERR-INVALID-RECIPIENT u206)
(define-constant ERR-TRANSFER-FAILED u207)

(define-constant MAX_WITHDRAW_PERCENT u50000000) ;; 50%
(define-constant EMERGENCY_PAUSE_BLOCKS u1440) ;; 1 day

(define-data-var pool-balance uint u0)
(define-data-var total-deposited uint u0)
(define-data-var total-withdrawn uint u0)
(define-data-var is-frozen bool false)
(define-data-var emergency-freeze-block (optional uint) none)
(define-data-var governance-contract principal 'SP000000000000000000002Q6VF78)
(define-data-var deployer principal tx-sender)

(define-map deposits
  principal
  {
    amount: uint,
    deposited-at: uint,
    last-withdrawal: uint
  }
)

(define-map withdrawals
  principal
  {
    total-withdrawn: uint,
    last-withdrawal-block: uint
  }
)

(define-map governance-approvals
  { proposer: principal, target: principal, amount: uint, expires: uint }
  bool
)

(define-read-only (get-pool-balance)
  (var-get pool-balance)
)

(define-read-only (get-total-deposited)
  (var-get total-deposited)
)

(define-read-only (get-total-withdrawn)
  (var-get total-withdrawn)
)

(define-read-only (get-depositor-info (depositor principal))
  (map-get? deposits depositor)
)

(define-read-only (get-withdrawal-info (depositor principal))
  (map-get? withdrawals depositor)
)

(define-read-only (is-pool-frozen)
  (or (var-get is-frozen)
      (let ((freeze-block (var-get emergency-freeze-block)))
        (match freeze-block fb
          (and (<= (+ fb EMERGENCY_PAUSE_BLOCKS) block-height) (> (var-get pool-balance) u0))
          false
          true))
  )
)

(define-read-only (can-withdraw-from-pool (amount uint))
  (let (
    (current-balance (var-get pool-balance))
    (max-withdrawable (* current-balance MAX_WITHDRAW_PERCENT))
  )
    (and (<= amount max-withdrawable)
         (>= current-balance amount)
         (not (is-pool-frozen)))
  )
)

(define-public (deposit (amount uint))
  (let (
    (caller tx-sender)
  )
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (not (is-pool-frozen)) (err ERR-POOL-FROZEN))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let (
      (existing (map-get? deposits caller))
    )
      (match existing
        deposit-info
          (let (
            (new-amount (+ (get amount deposit-info) amount))
            (new-total-deposited (+ (var-get total-deposited) amount))
          )
            (map-set deposits caller
              {
                amount: new-amount,
                deposited-at: (get deposited-at deposit-info),
                last-withdrawal: (get last-withdrawal deposit-info)
              }
            )
            (var-set total-deposited new-total-deposited)
          )
        ;; new depositor
        (begin
          (map-set deposits caller
            {
              amount: amount,
              deposited-at: block-height,
              last-withdrawal: u0
            }
          )
          (var-set total-deposited (+ (var-get total-deposited) amount))
        )
      )
    )
    (as-contract (contract-call? .PayoutEngine update-pool-balance (+ (var-get pool-balance) amount)))
    (var-set pool-balance (+ (var-get pool-balance) amount))
    (print { event: "deposit", depositor: caller, amount: amount })
    (ok amount)
  )
)

(define-public (withdraw-deposit (amount uint))
  (let (
    (caller tx-sender)
    (deposit-info (unwrap! (map-get? deposits caller) (err ERR-INSUFFICIENT-BALANCE)))
    (current-deposit (get amount deposit-info))
  )
    (asserts! (<= amount current-deposit) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (not (is-pool-frozen)) (err ERR-POOL-FROZEN))
    (let (
      (new-deposit (- current-deposit amount))
      (withdrawal-info (map-get? withdrawals caller))
    )
      (match withdrawal-info
        wd-info
          (let (
            (new-total-withdrawn (+ (get total-withdrawn wd-info) amount))
            (new-last-withdrawal block-height)
          )
            (map-set withdrawals caller
              {
                total-withdrawn: new-total-withdrawn,
                last-withdrawal-block: new-last-withdrawal
              }
            )
            (var-set total-withdrawn (+ (var-get total-withdrawn) amount))
          )
        ;; first withdrawal
        (begin
          (map-set withdrawals caller
            {
              total-withdrawn: amount,
              last-withdrawal-block: block-height
            }
          )
          (var-set total-withdrawn (+ (var-get total-withdrawn) amount))
        )
      )
      (map-set deposits caller
        {
          amount: new-deposit,
          deposited-at: (get deposited-at deposit-info),
          last-withdrawal: block-height
        }
      )
      (as-contract (contract-call? .PayoutEngine update-pool-balance (- (var-get pool-balance) amount)))
      (var-set pool-balance (- (var-get pool-balance) amount))
      (as-contract (stx-transfer? amount (as-contract tx-sender) caller))
      (print { event: "withdraw", depositor: caller, amount: amount })
      (ok amount)
    )
  )
)

(define-public (transfer-to-payout (amount uint) (installation-id uint))
  (begin
    (asserts! (can-withdraw-from-pool amount) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (contract-call? .PayoutEngine is-valid-claim installation-id) (err ERR-NOT-AUTHORIZED))
    (as-contract (stx-transfer? 
      amount 
      (as-contract tx-sender) 
      (contract-call? .PayoutEngine get-claim-recipient installation-id)
    ))
    (as-contract (contract-call? .PayoutEngine record-payout installation-id amount))
    (var-set pool-balance (- (var-get pool-balance) amount))
    (print { event: "payout-transfer", installation: installation-id, amount: amount })
    (ok amount)
  )
)

(define-public (set-governance-contract (new-governance principal))
  (begin
    (asserts! (is-eq tx-sender (var-get deployer)) (err ERR-NOT-DEPLOYER))
    (var-set governance-contract new-governance)
    (ok true)
  )
)

(define-public (emergency-freeze)
  (begin
    (asserts! (is-eq tx-sender (var-get governance-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get emergency-freeze-block)) (err ERR-POOL-FROZEN))
    (var-set emergency-freeze-block (some block-height))
    (print { event: "emergency-freeze", block: block-height })
    (ok true)
  )
)

(define-public (emergency-unfreeze)
  (begin
    (asserts! (is-eq tx-sender (var-get governance-contract)) (err ERR-NOT-AUTHORIZED))
    (match (var-get emergency-freeze-block)
      fb
        (begin
          (var-set emergency-freeze-block none)
          (print { event: "emergency-unfreeze", block: block-height })
          (ok true)
        )
      (err ERR-POOL-FROZEN)
    )
  )
)

(define-public (governance-withdraw (amount uint) (recipient principal))
  (let (
    (approval-key { proposer: tx-sender, target: recipient, amount: amount, expires: (- block-height u100) })
  )
    (asserts! (is-eq tx-sender (var-get governance-contract)) (err ERR-NOT-AUTHORIZED))
    (asserts! (can-withdraw-from-pool amount) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (not (is-eq recipient (as-contract tx-sender))) (err ERR-INVALID-RECIPIENT))
    (as-contract (stx-transfer? amount (as-contract tx-sender) recipient))
    (var-set pool-balance (- (var-get pool-balance) amount))
    (print { event: "governance-withdraw", amount: amount, recipient: recipient })
    (ok amount)
  )
)