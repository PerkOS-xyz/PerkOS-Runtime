# Visible, resilient ENS evidence

The real native acceptance turn exposed two obstacles: History shrank its embedded evidence controls, and concurrent reads hit PublicNode's rate limit. Keep History as the only scrolling container and give its evidence section its natural height.

For public verification, aggregate independent contract reads with viem Multicall, preserving the requested block. Use bounded failover between PublicNode and ethpandaops. Retrying the original burst alone repeats unnecessary load; relying only on a second provider simply moves the dependency. Batching plus a second provider addresses both without adding accounts or keys.

This reader does not sign or submit transactions. Invalid values still fail verification, and exhaustion of both transports must never retain a positive result. Test rate-limit failover, complete outage, and grouping with historical block preservation; validate a real exported packet before and after moving its ENS branch.

References: https://viem.sh/docs/clients/public and https://github.com/eth-clients/sepolia. Public chain ID and historical reads were checked on the two configured providers.
