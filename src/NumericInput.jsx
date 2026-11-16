import React from 'react';
import {decimalInputValue} from './numericPrecision.mjs';

export default function NumericInput({value, defaultValue, onChange, ...props}) {
  function change(event) {
    const input = event.currentTarget;
    const limited = decimalInputValue(input.value);
    if (limited !== input.value) input.value = limited;
    onChange?.(event);
  }

  return <input type="number" {...props} value={decimalInputValue(value)}
    defaultValue={decimalInputValue(defaultValue)} onChange={change}/>;
}
