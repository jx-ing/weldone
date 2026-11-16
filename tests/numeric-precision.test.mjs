import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalInputValue, formatDecimal} from '../src/numericPrecision.mjs';

test('界面显示四舍五入到两位并去掉多余的零', () => {
  assert.equal(formatDecimal(1.005), '1.01');
  assert.equal(formatDecimal(-1.235), '-1.24');
  assert.equal(formatDecimal(0.1 + 0.2), '0.3');
  assert.equal(formatDecimal(-0.004), '0');
  assert.equal(formatDecimal(12.5), '12.5');
});

test('数值输入限制小数位并保留空值和合规输入', () => {
  assert.equal(decimalInputValue('2.3456'), '2.35');
  assert.equal(decimalInputValue('1.000'), '1');
  assert.equal(decimalInputValue('1e-3'), '0');
  assert.equal(decimalInputValue('-0.50'), '-0.50');
  assert.equal(decimalInputValue(42), 42);
  assert.equal(decimalInputValue(''), '');
  assert.equal(decimalInputValue(undefined), undefined);
});
