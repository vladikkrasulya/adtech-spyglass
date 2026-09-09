'use strict';
const { classifyPrice } = require('./price-value');
const { makeFinding, LEVELS } = require('./findings');
function negativeFloorFindings(value, path, deals, dealBase, leaf) {
  const findings = [];
  if (classifyPrice(value).negative)
    findings.push(makeFinding('floor.negative', LEVELS.WARNING, path));
  if (Array.isArray(deals))
    deals.forEach((deal, i) => {
      if (deal && classifyPrice(deal[leaf]).negative)
        findings.push(makeFinding('floor.negative', LEVELS.WARNING, `${dealBase}[${i}].${leaf}`));
    });
  return findings;
}
module.exports = { negativeFloorFindings };
