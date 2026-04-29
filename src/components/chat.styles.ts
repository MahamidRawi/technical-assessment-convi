import type React from 'react';

export const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  maxWidth: '800px',
  width: '100%',
  margin: '0 auto',
};

export const messagesAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

export const formStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  left: '50%',
  transform: 'translateX(-50%)',
  width: '100%',
  maxWidth: '720px',
  padding: '0 20px',
  zIndex: 100,
};

export const formToolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  minHeight: '28px',
  marginBottom: '6px',
};

export const clearButtonStyle: React.CSSProperties = {
  border: '1px solid #d8d8d8',
  backgroundColor: '#ffffff',
  color: '#555',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  padding: '4px 8px',
  cursor: 'pointer',
  boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
};

export const clearButtonDisabledStyle: React.CSSProperties = {
  ...clearButtonStyle,
  color: '#aaa',
  cursor: 'not-allowed',
};

export const inputWrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 56px 14px 20px',
  borderRadius: '999px',
  border: '1px solid #d0d0d0',
  fontSize: '15px',
  outline: 'none',
  backgroundColor: '#ffffff',
  boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
};

export const inputFocusStyle: React.CSSProperties = {
  ...inputStyle,
  border: '1px solid #0066ff',
  boxShadow: '0 2px 16px rgba(0,102,255,0.15)',
};

export const iconButtonStyle: React.CSSProperties = {
  position: 'absolute',
  right: '8px',
  width: '34px',
  height: '34px',
  borderRadius: '50%',
  border: 'none',
  backgroundColor: '#0066ff',
  color: '#ffffff',
  fontSize: '18px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

export const iconButtonDisabledStyle: React.CSSProperties = {
  ...iconButtonStyle,
  backgroundColor: '#d0d0d0',
  cursor: 'not-allowed',
};

export const stopButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  backgroundColor: '#cc0000',
};
