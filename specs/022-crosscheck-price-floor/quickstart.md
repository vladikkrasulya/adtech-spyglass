# Quickstart Validation: Crosscheck Price and Floor

Prerequisites: repo checkout, Node.js >= 22.13.0, `npm ci` already run. Commands run from the
repository root.

## 1. Reproduce the three defects (before/after)

```bash
node -e '
const { crosscheck } = require("@ortbtools/core");
const req = { id: "r1", at: 2, site: { domain: "a.com" }, cur: ["USD"],
  imp: [{ id: "1", banner: { w: 300, h: 250 }, bidfloor: 0.1,
          pmp: { deals: [{ id: "D1", bidfloor: 0.75 }] } }] };
const bid = (p, d) => ({ id: "r1", cur: "USD", seatbid: [{ bid: [
  { id: "b1", impid: "1", price: p, dealid: d, adm: "<div></div>", w: 300, h: 250 }] }] });
const show = (label, res) => console.log(label,
  crosscheck(req, res).filter((c) => /price|floor/.test(c.id))
    .map((c) => c.id + "[" + c.level + "]" + (c.params.floor ? " floor=" + c.params.floor : "")).join(", "));
show("price []      ", bid([]));
show("price -1      ", bid(-1));
show("price \"1.25\"  ", bid("1.25"));
show("0.50 on deal  ", bid(0.5, "D1"));
'
```

Before this feature: the first three print a floor verdict on a coerced number, and the deal bid
prints `above_floor floor=0.1000`. After: the first three print `price_invalid[crit]`, and the deal
bid prints `below_floor[warn] floor=0.7500`.

## 2. The OpenRTB 3.0 pair

```bash
node -e '
const { validate, crosscheck } = require("@ortbtools/core");
const req = { openrtb: { ver: "3.0", request: { id: "r1", cur: ["EUR"],
  item: [{ id: "1", flr: 0.5, flrcur: "EUR", spec: { placement: { display: { w: 300, h: 250 } } } }] } } };
const res = { openrtb: { ver: "3.0", response: { id: "r1", cur: "EUR", seatbid: [{ seat: "s1",
  bid: [{ id: "b1", item: "1", price: 0.9, media: { ad: { display: { adm: "<div></div>", w: 300, h: 250 } } } }] }] } } };
console.log(validate(res, { pairReq: req }).findings.filter((f) => /cur/.test(f.id)).map((f) => f.id));
console.log(crosscheck(req, res).filter((c) => /floor/.test(c.id)).map((c) => c.id + " floor=" + c.params.floor));
'
```

Before: `[ 'err-bid-currency-mismatch' ]` and a currency-mismatch warning instead of a verdict.
After: `[]` and `crosscheck.bid.above_floor floor=0.5000`.

## 3. Regression suites

```bash
node --test tests/crosscheck-price-floor.test.js tests/validator.test.js tests/crosscheck-audit.test.js tests/rules-etap-b-2.test.js tests/floor-audit.test.js tests/ortb30.test.js tests/spec-refs.test.js tests/i18n-audit.test.js tests/cli.test.js
```

## 4. The 020 corpus

```bash
node --test tests/corpus-lib.test.js tests/corpus-report.test.js tests/corpus-axes.test.js tests/corpus-fixture-contract.test.js tests/corpus-core.test.js tests/corpus-http.test.js
```

## 5. Repository gate

```bash
npm run ci
```
