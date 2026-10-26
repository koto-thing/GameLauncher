import React from 'react';
import { createRoot } from 'react-dom/client';
import { LtManager } from '../../app/lt/LtManager';
import '../../app/globals.css';
createRoot(document.getElementById('root')).render(<main className="lt-page"><LtManager /></main>);
