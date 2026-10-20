# lifebid

lifebid is a friendly lowest-unique-bid auction demo for Ethiopia. It uses Node.js built-ins only; no package installation is required.

## Run it

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different port. Demo data is saved to `data/store.json`; keep that file backed up if you want to preserve the local demo.

Administrators can add an optional item photo in **Admin desk → Add an auction**. Choose a JPG, PNG, or WebP image up to 2 MB; it is stored locally in `data/uploads` and served with the auction. Back up that folder along with `data/store.json` to preserve uploaded photos.

To create a regular demo account, choose **Sign up** and enter a valid Ethiopian phone number. To try the demo administrator account, choose **Sign in**:

- Phone: `+251912846151`
- In preview mode, the verification code is generated and shown on screen.

Any other valid Ethiopian phone number can create a regular account. Sign-up requires a password of at least 5 characters and phone verification. Sign-in requires the phone, password, and a one-time phone code. Passwords are salted and hashed with scrypt; plaintext passwords are not stored. Existing accounts created before passwords were added can set a password after verifying their phone once. The administrator account uses the same password and phone-verification flow; if it predates passwords, it sets its password on first verified sign-in. Without SMS credentials, a fresh one-time code is displayed in the interface and no SMS is sent. Preview entry fees are simulated; no money is charged. Bids are saved privately to the local data store, and closing results and admin actions are recorded in a hash-linked audit log.

## Configure phone verification

Create an Africa's Talking account, enable SMS for Ethiopia, and configure a sender name if your account requires one. Set the provider credentials in the server environment (never in browser code or committed files):

```sh
SMS_PROVIDER=africastalking
AFRICASTALKING_USERNAME="your_account_username"
AFRICASTALKING_API_KEY="set_this_privately_in_your_server_environment"
AFRICASTALKING_SENDER_ID=your_approved_sender_name
```

Do not put real credentials in this file or commit them. Any API key previously saved in this README should be revoked and replaced.

For the Africa's Talking sandbox, use `AFRICASTALKING_USERNAME=sandbox` and the sandbox API key. Restart the app after setting credentials. With the provider configured, verification codes are sent by SMS, expire after five minutes, allow up to five attempts, and are limited to three requests per phone and client address in 15 minutes. Without credentials, the app clearly identifies preview mode and shows the generated code rather than claiming an SMS was sent.

## Check it

```sh
npm test
```

## Before launch

This is a prototype, not a payment-ready or production identity system. Before taking real bids or payments, configure and test:

- Production SMS provider account approval, sender configuration, monitoring, account recovery, and secure session storage.
- A real payment-provider adapter for entry fees, idempotent payment callbacks, refunds, reconciliation, and the winner's separate item payment. The included provider only simulates the entry fee; the admin's settlement note records an independently verified off-platform payment and does not process it.
- Production database transactions and durable, access-controlled, backed-up audit logs. The local JSON store is for a single-process demo and is not safe for concurrent production use.
- Business registration, item sourcing and condition checks, a published refund and dispute policy, delivery operations, privacy terms, and applicable Ethiopian legal and payment-provider approvals.
- A reviewed fallback rule for auctions with no unique bid. The admin can publish one of two clear demo rules before future bids are placed.

Demo winners appear only after an actual demo auction closes. The seeded page starts with an empty verified-winner list rather than invented results.







"
Before opening Lifebid to real users, these items still need attention:

Phone verification: Configure and test Africa’s Talking with a replacement API key. A key was previously shared in chat, so revoke it if you haven’t already. Preview mode displays OTP codes on screen and isn’t safe for public use.
Real payments: Add and test a payment provider, including duplicate-payment protection, refunds, and reconciliation. Payments are currently simulated.
Production data and sign-in: Replace the local JSON store and in-memory sessions with durable, protected production storage. 
 The 5-character password minimum you requested is okay for the preview, but should be increased before launch.
Launch operations: Finalize the published tie-break and refund policies, delivery process, item checks, and applicable business/legal requirements.
Photo backups: Uploaded item pictures are saved in data/uploads; back up that folder along with data/store.json.

"