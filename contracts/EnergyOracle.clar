(define-constant ERR-NOT-AUTHORIZED u300)
(define-constant ERR-INVALID-INSTALLATION u301)
(define-constant ERR-INVALID-KWH u302)
(define-constant ERR-ALREADY-REPORTED u303)
(define-constant ERR-ORACLE-NOT-SET u304)
(define-constant ERR-BLOCK-TOO-OLD u305)
(define-constant ERR-SIGNATURE-VERIFICATION-FAILED u306)
(define-constant ERR-INVALID-SIGNER u307)

(define-constant REPORT-WINDOW-BLOCKS u144) ;; 24 hours
(define-constant MAX-KWH-PER-KW-PER-HOUR u6) ;; 6 kWh per kW per hour (peak sun)
(define-constant MICRO-KWH u1000000)

(define-data-var oracle-principal principal 'SP000000000000000000002Q6VF78)
(define-data-var admin principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var last-report-block uint u0)
(define-data-var total-reports uint u0)

(define-map energy-reports
  { installation-id: uint, block-height: uint }
  {
    kwh-produced: uint,
    reported-at: uint,
    reporter: principal,
    signature: (buff 65),
    verified: bool
  }
)

(define-map installation-capacities
  uint
  uint
)

(define-map oracle-signers
  principal
  bool
)

(define-read-only (get-oracle-principal)
  (ok (var-get oracle-principal))
)

(define-read-only (get-report (installation-id uint) (block-height uint))
  (map-get? energy-reports { installation-id: installation-id, block-height: block-height })
)

(define-read-only (get-total-reports)
  (ok (var-get total-reports))
)

(define-read-only (is-oracle-paused)
  (var-get is-paused)
)

(define-read-only (validate-report-window (target-block uint))
  (let (
    (current-block block-height)
    (oldest-allowed (- current-block REPORT-WINDOW-BLOCKS))
  )
    (and (>= target-block oldest-allowed) (< target-block current-block))
  )
)

(define-read-only (get-max-expected-kwh (capacity-kw uint) (hours uint))
  (* (* capacity-kw MAX-KWH-PER-KW-PER-HOUR) hours)
)

(define-public (set-oracle-principal (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-principal new-oracle)
    (ok true)
  )
)

(define-public (add-oracle-signer (signer principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-principal)) (err ERR-NOT-AUTHORIZED))
    (map-set oracle-signers signer true)
    (ok true)
  )
)

(define-public (remove-oracle-signer (signer principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-principal)) (err ERR-NOT-AUTHORIZED))
    (map-delete oracle-signers signer)
    (ok true)
  )
)

(define-public (pause-oracle)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-oracle)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (register-capacity (installation-id uint) (capacity-kw uint))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .InstallationRegistry get-contract)) (err ERR-NOT-AUTHORIZED))
    (map-set installation-capacities installation-id capacity-kw)
    (ok true)
  )
)

(define-public (submit-report
  (installation-id uint)
  (target-block uint)
  (kwh-produced-micro uint)
  (signature (buff 65))
)
  (let (
    (capacity (unwrap! (map-get? installation-capacities installation-id) (err ERR-INVALID-INSTALLATION)))
    (hours-since-report (- block-height target-block))
    (max-kwh-micro (* (get-max-expected-kwh capacity hours-since-report) MICRO-KWH))
    (existing-report (get-report installation-id target-block))
  )
    (asserts! (not (var-get is-paused)) (err ERR-ORACLE-NOT-SET))
    (asserts! (validate-report-window target-block) (err ERR-BLOCK-TOO-OLD))
    (asserts! (is-none existing-report) (err ERR-ALREADY-REPORTED))
    (asserts! (<= kwh-produced-micro max-kwh-micro) (err ERR-INVALID-KWH))
    (asserts! (map-get? oracle-signers tx-sender) (err ERR-INVALID-SIGNER))
    
    (let (
      (message-hash (hash160 (concat (concat (uint-to-ascii installation-id) (uint-to-ascii target-block)) (uint-to-ascii kwh-produced-micro))))
      (is-valid-sig (secp256k1-verify message-hash signature (get-public-key-from-sig signature)))
    )
      (asserts! is-valid-sig (err ERR-SIGNATURE-VERIFICATION-FAILED))
      
      (map-set energy-reports
        { installation-id: installation-id, block-height: target-block }
        {
          kwh-produced: (div kwh-produced-micro MICRO-KWH),
          reported-at: block-height,
          reporter: tx-sender,
          signature: signature,
          verified: true
        }
      )
      (var-set total-reports (+ (var-get total-reports) u1))
      (var-set last-report-block block-height)
      
      (try! (contract-call? .PayoutEngine submit-oracle-output installation-id (div kwh-produced-micro MICRO-KWH)))
      (print { event: "energy-reported", installation: installation-id, kwh: (div kwh-produced-micro MICRO-KWH), block: target-block })
      (ok true)
    )
  )
)

(define-private (get-public-key-from-sig (sig (buff 65)))
  (secp256k1-recover-public-key (slice? sig u1 u65))
)

(define-private (uint-to-ascii (value uint))
  (unwrap-panic (element-at "0123456789" (mod value u10)))
)

(define-private (secp256k1-verify (message-hash (buff 32)) (signature (buff 65)) (pubkey (buff 33)))
  (is-eq (keccak256 (concat (concat message-hash signature) pubkey)) message-hash)
)