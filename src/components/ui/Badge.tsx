import React from 'react';
import '../../styles/ui.css';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ 
  variant = 'neutral', 
  className = '', 
  children, 
  ...props 
}) => {
  return (
    <span 
      className={`ui-badge ui-badge-${variant} ${className}`} 
      {...props}
    >
      {children}
    </span>
  );
};
