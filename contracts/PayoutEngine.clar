(define-constant ERR-NOT-FOUND u100)
(define-constant ERR-NOT-AUTHORIZED u101)
(define-constant ERR-ALREADY-CLAIMED u102)
(define-constant ERR-INSUFFICIENT-OUTPUT u103)
(define-constant ERR-POOL-EMPTY u104)
(define-constant ERR-INVALID-INSTALLATION u105)
(define-constant ERR-RATE-NOT-SET u106)
(define-constant ERR-ORACLE-FAIL u107)

(define-constant SUBSIDY-TOKEN u0)
(define-constant MICRO-STX u1)

(define-data-var subsidy-rate-per-kwh uint u0)
(define-data-var total-subsidized-kwh uint u0)
(define-data-var last-claim-block uint u0)

(define-map installations
  uint
  {
    owner: principal,
    capacity-kw: uint,
    registered-at: uint,
    verified: bool,
    last-claimed-output: uint
  }
)

(define-map claimed-outputs
  { installation-id: uint, block: uint }
  bool
)

(define-map energy-outputs
  { installation-id: uint, block: uint }
  uint
)

(define-read-only (get-installation (id uint))
  (map-get? installations id)
)

(define-read-only (get-subsidy-rate)
  (ok (var-get subsidy-rate-per-kwh))
)

(define-read-only (get-total-subsidized)
  (ok (var-get total-subsidized-kwh))
)

(define-read-only (get-claimed-status (installation-id uint) (block-height uint))
  (map-get? claimed-outputs { installation-id: installation-id, block: block-height })
)

(define-read-only (calculate-payout (kwh-produced uint))
  (let (
    (rate (var-get subsidy-rate-per-kwh))
  )
    (if (is-eq rate u0)
      (err ERR-RATE-NOT-SET)
      (ok (mul kwh-produced rate))
    )
  )
)

(define-public (set-subsidy-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .Governance get-admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-rate u0) (err ERR-INVALID-UPDATE-PARAM))
    (var-set subsidy-rate-per-kwh new-rate)
    (ok true)
  )
)

(define-public (register-installation (capacity-kw uint))
  (let (
    (id (contract-call? .InstallationRegistry get-next-id))
    (owner tx-sender)
  )
    (try! (contract-call? .InstallationRegistry register id owner capacity-kw))
    (map-set installations id
      {
        owner: owner,
        capacity-kw: capacity-kw,
        registered-at: block-height,
        verified: false,
        last-claimed-output: u0
      }
    )
    (ok id)
  )
)

(define-public (submit-oracle-output (installation-id uint) (kwh-produced uint))
  (let (
    (installation (unwrap! (map-get? installations installation-id) (err ERR-NOT-FOUND)))
  )
    (asserts! (is-eq (contract-call? .EnergyOracle get-oracle) tx-sender) (err ERR-NOT-AUTHORIZED))
    (map-set energy-outputs
      { installation-id: installation-id, block: block-height }
      kwh-produced
    )
    (ok true)
  )
)

(define-public (claim-subsidy (installation-id uint))
  (let (
    (installation (unwrap! (map-get? installations installation-id) (err ERR-NOT-FOUND)))
    (owner (get owner installation))
    (current-output (default-to u0 (map-get? energy-outputs { installation-id: installation-id, block: (- block-height u1) })))
    (last-claimed (get last-claimed-output installation))
    (new-output (if (> current-output last-claimed) (- current-output last-claimed) u0))
    (payout-amount (try! (calculate-payout new-output)))
    (pool-balance (contract-call? .SubsidyPool get-balance))
  )
    (asserts! (is-eq tx-sender owner) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-output u0) (err ERR-INSUFFICIENT-OUTPUT))
    (asserts! (not (is-some (get-claimed-status installation-id (- block-height u1)))) (err ERR-ALREADY-CLAIMED))
    (asserts! (>= pool-balance payout-amount) (err ERR-POOL-EMPTY))
    (try! (contract-call? .SubsidyPool transfer payout-amount owner))
    (map-set claimed-outputs
      { installation-id: installation-id, block: (- block-height u1) }
      true
    )
    (map-set installations installation-id
      (merge installation
        {
          last-claimed-output: current-output,
          verified: true
        }
      )
    )
    (var-set total-subsidized-kwh (+ (var-get total-subsidized-kwh) new-output))
    (print { event: "subsidy-claimed", installation: installation-id, kwh: new-output, amount: payout-amount })
    (ok payout-amount)
  )
)

(define-private (mul (a uint) (b uint))
  (* a b)
)