import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { clearEEG, clearPacket } from './db';

const checkAndClear = async () => {
    if (localStorage.getItem('deleteEEGOnClose') !== 'false') {
        await clearEEG();
    }
    if (localStorage.getItem('deletePacketOnClose') !== 'false') {
        await clearPacket();
    }
};

checkAndClear();

window.addEventListener('beforeunload', () => {
    if (localStorage.getItem('deleteEEGOnClose') !== 'false') {
        clearEEG();
    }
    if (localStorage.getItem('deletePacketOnClose') !== 'false') {
        clearPacket();
    }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <App />
);
