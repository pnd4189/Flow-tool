import React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const Select: React.FC<SelectProps> = ({ label, className = '', children, ...props }) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium mb-1">
          {label}
        </label>
      )}
      <select
        className={`w-full bg-[#1b1b20] border border-[#26262b] text-[#ececef] rounded h-7 px-2 text-[12px] focus:border-[#f5b301] focus:outline-none transition ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
};
