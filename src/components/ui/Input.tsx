import React from 'react';
import '../../styles/ui.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ 
  label, 
  error, 
  className = '', 
  id,
  ...props 
}) => {
  const inputId = id || props.name || Math.random().toString(36).substr(2, 9);

  return (
    <div className="ui-input-wrapper">
      {label && (
        <label htmlFor={inputId} className="ui-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`ui-input ${error ? 'ui-input-error' : ''} ${className}`}
        {...props}
      />
      {error && <span className="ui-input-error-message">{error}</span>}
    </div>
  );
};
