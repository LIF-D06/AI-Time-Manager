import React from 'react';
import { Button } from './Button';
import '../../styles/ui.css';

interface ToggleButtonProps {
  isToggled: boolean;
  onToggle: () => void;
  toggledIcon?: React.ReactNode;
  untoggledIcon?: React.ReactNode;
  toggledText?: string;
  untoggledText?: string;
  toggledClassName?: string;
  className?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
}

export const ToggleButton: React.FC<ToggleButtonProps> = ({
  isToggled,
  onToggle,
  toggledIcon,
  untoggledIcon,
  toggledText,
  untoggledText,
  toggledClassName = 'toggled',
  className = '',
  disabled = false,
  variant = 'ghost',
}) => {
  return (
    <Button
      variant={variant}
      className={`ui-toggle-btn ${isToggled ? toggledClassName : ''} ${className}`}
      onClick={onToggle}
      disabled={disabled}
    >
      {isToggled ? (
        <>
          {toggledIcon}
          {toggledText && <span>{toggledText}</span>}
        </>
      ) : (
        <>
          {untoggledIcon}
          {untoggledText && <span>{untoggledText}</span>}
        </>
      )}
    </Button>
  );
};
