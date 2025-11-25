import React from 'react';
import '../../styles/Schedule.css';

interface Option {
  value: string;
  label: React.ReactNode;
}

interface ViewToggleProps {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  className?: string;
}

const ViewToggle: React.FC<ViewToggleProps> = ({ value, onChange, options, className = '' }) => {
  return (
    <div className={`filter-group ${className}`} role="tablist">
      {options.map(opt => (
        <button
          key={String(opt.value)}
          type="button"
          className={`filter-btn ${opt.value === value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
          role="tab"
          aria-selected={opt.value === value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

export default ViewToggle;
