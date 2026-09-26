# Visible ENSIP-25 verification

The ENS integration must show how a real ERC-8004 registration and an ENS V2 name attest to each other. A static standard badge alone cannot establish this. The user requested visible proof in Identity, public exploration and transaction activity.

Use a shared summary and per-agent proof in Identity and the public explorer. Show the actual onchain metadata claim, parameterized attestation key, returned value, agent ID, registry, chain and verification block. A positive badge requires the existing canonical-pointer, ownership, registry and metadata checks to pass. Pending or failed reads never display success. Keep publication permission separate: Trader has an identity without ENS write access.

Alternatives considered: a static badge is insufficient evidence; displaying every raw field expanded for all seven agents overwhelms the team view. A visible status and expandable proof preserves both clarity and auditability. Activity names explicitly identify ENSIP-25 publication, with the existing receipt links.

The reader accepts any non-empty attestation value, as required by https://docs.ens.domains/ensip/25/. Writers continue using the recommended value "1". The specification remains a draft. Tests cover alternative non-empty values, empty records, mismatched metadata, RPC errors and truthful UI states. Validate the visual output against the real provisioned team after creation finishes.
