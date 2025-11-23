import React from 'react';
import '../../styles/ui.css';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ 
  label, 
  error, 
  className = '', 
  id,
  ...props 
}) => {
  const textareaId = id || props.name || Math.random().toString(36).substr(2, 9);

  return (
    <div className="ui-input-wrapper">
      {label && (
        <label htmlFor={textareaId} className="ui-label">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={`ui-textarea ${error ? 'ui-input-error' : ''} ${className}`}
        {...props}
      />
      {error && <span className="ui-input-error-message">{error}</span>}
    </div>
  );
};
