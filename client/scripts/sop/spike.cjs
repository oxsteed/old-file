// Compatibility entry point for the original discovery spike.
// Uses the portable shared fixture; run with an area, e.g. account.
process.argv[2] ||= "account";
require("./discover.cjs");
