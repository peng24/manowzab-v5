import React, { createContext, useContext, useState } from 'react';

const GlobalContext = createContext();

export const GlobalProvider = ({ children }) => {
  const [modals, setModals] = useState({
    dashboard: false,
    history: false,
    shippingManager: false,
    phoneticManager: false,
    noteEditor: false
  });

  const openModal = (name) => setModals(prev => ({ ...prev, [name]: true }));
  const closeModal = (name) => setModals(prev => ({ ...prev, [name]: false }));

  return (
    <GlobalContext.Provider value={{ modals, openModal, closeModal }}>
      {children}
    </GlobalContext.Provider>
  );
};

export const useGlobal = () => useContext(GlobalContext);
