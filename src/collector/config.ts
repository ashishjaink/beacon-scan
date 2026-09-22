import { BeaconConfig } from "../types.js";
import rawDefaultConfig from "../../beacon.config.json" with { type: "json" };

/** `beacon.config.json`, parsed and validated once. The single source of defaults for
 * every collector entry point (`collect`, `collectOffline`, `samplePdpMarkers`) — callers
 * only ever need to supply a `Partial<BeaconConfig>` override. */
export const defaultConfig: BeaconConfig = BeaconConfig.parse(rawDefaultConfig);

/** Shallow-merges a partial config over the defaults, one level deep per top-level key
 * (each top-level key of BeaconConfig is itself an object, so a spread per key is enough
 * — callers never need to supply a fully-populated nested object just to override one
 * field). */
export function mergeConfig(partial?: Partial<BeaconConfig>): BeaconConfig {
  if (!partial) return defaultConfig;
  return {
    weights: { ...defaultConfig.weights, ...partial.weights },
    merchCollectionRegex: partial.merchCollectionRegex ?? defaultConfig.merchCollectionRegex,
    thresholds: { ...defaultConfig.thresholds, ...partial.thresholds },
    http: { ...defaultConfig.http, ...partial.http },
    limits: { ...defaultConfig.limits, ...partial.limits },
  };
}
