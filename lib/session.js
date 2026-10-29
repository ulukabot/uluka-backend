// lib/session.js
function getSessionMultiplier() {
  const now = new Date();
  const hour = now.getUTCHours(); // Use UTC time
  
  // 13:00 - 16:00 UTC = Overlap
  if (hour >= 13 && hour < 16) return { name: 'Overlap', mult: 1.20 };
  
  // 07:00 - 16:00 UTC = London
  if (hour >= 7 && hour < 16) return { name: 'London', mult: 0.95 };
  
  // 13:00 - 22:00 UTC = New York
  if (hour >= 13 && hour < 22) return { name: 'New York', mult: 1.05 };
  
  // 00:00 - 09:00 UTC = Asian
  if (hour >= 0 && hour < 9) return { name: 'Asian', mult: 0.75 };
  
  // Default (Late NY / Early Asia)
  return { name: 'Standard', mult: 1.00 };
}

module.exports = { getSessionMultiplier };
