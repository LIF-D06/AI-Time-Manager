import React from 'react';
import '../../styles/ui.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  children, 
  ...props 
}) => {
  return (
    <button 
      className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} 
      {...props}
    >
      {children}
    </button>
  );
};
