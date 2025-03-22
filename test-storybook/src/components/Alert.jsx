import React from 'react';
import './alert.css';

/**
 * Alert component for displaying important messages to users
 */
const Alert = ({ 
  variant = 'info', 
  children, 
  title,
  dismissible = false,
  onDismiss,
  ...props 
}) => {
  const alertClasses = ['alert', `alert-${variant}`].join(' ');
  
  return (
    <div className={alertClasses} role="alert" {...props}>
      {title && <div className="alert-title">{title}</div>}
      <div className="alert-content">{children}</div>
      {dismissible && (
        <button 
          className="alert-dismiss" 
          aria-label="Dismiss" 
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
};

export default Alert;
