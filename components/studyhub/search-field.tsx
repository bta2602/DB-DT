'use client';

import { useState } from 'react';
import { SearchSelect, type SearchOption } from './search-select';

/** Named search field for existing forms submitted through FormData. */
export function SearchField({
  label,
  name,
  options,
  defaultValue = '',
  placeholder,
  required,
  disabled,
}: {
  label: string;
  name: string;
  options: SearchOption[];
  defaultValue?: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <SearchSelect
      label={label}
      name={name}
      options={options}
      value={value}
      onChange={setValue}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
    />
  );
}
