# Esoqo Counter - User Guide

## Overview

The Counter is your main interface for handling parcels at the desk. Whether you're receiving walk-in drop-offs or creating new shipments, this single page handles everything with a unified scanning experience.

---

## Quick Start

### For First-Time Users

1. **Scan a code** to get started - just type or scan any code in the main scan box
2. The system will automatically detect what type of code it is and take you to the right action
3. Follow the on-screen instructions to complete your task

### For Experienced Users

- **Scanner gun users**: The scan box stays focused - just scan and move to the next customer
- **Keyboard users**: Type codes directly and press Enter to submit
- **Camera scanning**: Click the "Scan" button and point your phone camera at the QR code

---

## Main Sections

### 1. Quick Scan Bar (Top of Page)

This is your primary input method. Use it to scan any code:

```
┌────────────────────────────────────────────────────────────┐
│  [QR Icon] Quick Scan                                      │
│  Scan a code to get started                                │
├────────────────────────────────────────────────────────────┤
│  [__________________Scan code here..._________________]   │
│  [ Scan ] [ Scanner Button ] [Choose Label*]              │
└────────────────────────────────────────────────────────────┘
```

#### How to Use:

1. **Type or scan a code** in the input field
   - Valid codes: `PKG-XXXXXX` (labels) or `TCK-XXXXXX` (tickets)
   - The system accepts both typed input and scanner gun input
2. **Click "Scan"** or press Enter
3. The system will:
   - Detect the code type automatically
   - Route you to the appropriate action
   - Show a confirmation message

#### Code Types:

| Code Type | Example | Action |
|-----------|---------|--------|
| `PKG-XXXXXX` | PKG-ABCD12 | Label for booking |
| `TCK-XXXXXX` | TCK-WXYZ99 | Ticket for receiving |
| Parcel code | Any other code | Best-effort processing |

### 2. Tab Navigation

After scanning, you'll be in one of three modes:

#### Receive Mode

**For**: Riders receiving walk-in drop-offs

**What you see**:
- A list of parcels waiting at the desk
- Scan box ready for receiving
- Payment recording option after receiving

**How to receive**:
1. Scan the customer's ticket or parcel code
2. The system records custody
3. Record the payment amount if paid at counter
4. The label prints automatically

**Key features**:
- Shows waiting parcels with sender details
- "Confirm Receipt" button for each parcel
- Payment recording with amount input
- Label printing after payment

#### New Shipment Mode

**For**: Creating new shipments

**What you see**:
- Full booking form with all fields
- Customer details (sender/receiver)
- Measurement inputs
- Pricing display

**How to create a shipment**:
1. Scan a label or click "New Booking"
2. Fill in sender details (name, phone)
3. Fill in receiver details (name, phone, destination)
4. Enter measurements (weight, dimensions)
5. Select pricing bracket
6. Click "Book parcel"
7. Confirm the box is received (sends SMS to both parties)
8. Print the label

**Smart features**:
- **Party memory**: Types names after 3 characters
- **Volumetric calculation**: Shows air vs actual weight
- **Label preload**: Scanning a label loads it automatically
- **Offline support**: Books held if no connection

#### Labels Mode

**For**: Managing label stock

**What you see**:
- List of available labels
- Batch information
- Search functionality

**How to use labels**:
1. Search for a specific label code
2. Click on a blank label to select it
3. The label is loaded into the booking form

---

## Scanning Guide

### Using a Scanner Gun

Scanner guns act as keyboards. Just:

1. **Scan the code** - it types into the focused input
2. **Gun triggers Enter** automatically
3. **Input stays focused** - ready for next customer

### Using Camera

1. Click the **Scan** button next to the input
2. **Allow camera permission** if prompted
3. **Point at QR code** (6-12 inches away)
4. **Wait for beep/vibration** - code detected
5. **Camera auto-closes**

### Camera Troubleshooting

| Issue | Solution |
|-------|----------|
| "Scanner not available" | Page must be accessed via HTTPS or localhost |
| "Camera permission denied" | Enable camera in browser settings |
| "No camera found" | Check camera connections or use typed input |

### Using Keyboard Only

1. **Type the code** directly
2. **Press Enter** to submit
3. Or **click "Scan"** button

---

## Common Workflows

### Receive a Walk-in Drop-off

```
1. Customer arrives with parcel
2. Scan their ticket code (TCK-XXXXXX)
3. System shows: "Received - Box in your custody"
4. Customer pays: Enter amount (e.g., "2500")
5. Click "Record payment"
6. Label prints automatically
7. Hand receipt to customer
8. Scan next code
```

### Create a New Shipment

```
1. Scan a blank label (PKG-XXXXXX)
2. OR click "New Shipment" tab
3. Fill in sender details:
   - Name: John Doe
   - Phone: 0712345678
4. Fill in receiver details:
   - Name: Jane Smith
   - Phone: 0798765432
   - Destination: Nairobi, Westlands
5. Enter measurements:
   - Weight: 2.5 kg
   - Length: 40 cm
   - Width: 30 cm
   - Height: 20 cm
6. System shows: "Volumetric 3.2kg - bulkier than heavy"
7. Confirm pricing bracket
8. Click "Book parcel"
9. Click "Confirm the box is here" (sends SMS)
10. Print label
11. Stick label on box
12. Hand to customer
```

### Book Against Existing Label

```
1. Scanner finds label already has info on it
2. System shows: "Label already has field notes"
3. Fields auto-populate with previous info
4. Review/update any fields as needed
5. Click "Book parcel"
6. Complete as above
```

---

## Tips for Efficiency

### Scanner Gun Workflow

```
┌───────────────────────────────────────────────────────┐
│ Scan → Wait → Scan → Wait → Scan → Wait             │
│ ↓        ↓     ↓        ↓     ↓        ↓             │
│ [Box]   [Enter] [Box]   [Enter] [Box]   [Enter]    │
└───────────────────────────────────────────────────────┘
```

1. **Scan first code** → System processes automatically
2. **Scan next code** → Previous action continues, new code queued
3. **No clicking needed** → Gun Enter key handles everything

### Keyboard Workflow

```
Tab through fields: Shift+Tab → Enter
Scan → Enter → Next customer
```

1. Use **Tab** to move between fields
2. Use **Enter** to submit forms
3. Use **Esc** to close dialogs

### Camera Workflow

1. **Open scanner** (click button)
2. **Keep phone steady**
3. **Scan code** → Camera auto-closes
4. **Action happens automatically**

---

## Understanding Status Messages

After scanning, you'll see one of these messages:

### Success Messages
- `PKG-XXXXXX received` - Label loaded for booking
- `TCK-XXXXXX received` - Parcel in your custody
- `Received - Box in your custody` - Custody recorded
- `Payment recorded` - Payment confirmed

### Informational Messages
- `Label already has field notes` - Data loaded from previous session
- `Booked` - Shipment created
- `Saved to label` - Partial info saved for later

### Error Messages
- `Code not found` - Invalid or unregistered code
- `Cannot receive parcels` - Wrong account type
- `That label was withdrawn` - Label no longer valid

---

## Troubleshooting

### Problem: "Scanner not available"

**Causes**:
- Page accessed via HTTP (not HTTPS)
- On mobile, accessed via local IP address

**Solutions**:
- Use `https://yourdomain.com` instead of `http://`
- For local testing, use `http://localhost:3001` on the same device
- For mobile testing, find your computer's IP and access `http://YOUR_IP:3001`

### Problem: "Camera permission denied"

**Solutions**:
1. Open browser settings
2. Find "Site settings" or "Permissions"
3. Search for this site
4. Enable camera access
5. Reload page

### Problem: "Label already booked"

**Solution**:
- This is the correct behavior - you're trying to book something already booked
- Click "Open parcel" to see the existing booking
- If this is a mistake, contact support

### Problem: "Volumetric weight is higher"

**Explanation**:
- Air freight charges by volume, not weight
- Formula: (Length × Width × Height) / 5000
- If volumetric > actual, you're charged for volumetric
- This is standard across courier companies

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close dialogs/modals |
| `Enter` | Submit forms, scan codes |
| `Shift+Tab` | Move backwards between fields |
| `Tab` | Move forward between fields |
| `Ctrl+K` (or `Cmd+K`) | Open quick search (admin only) |

---

## Features Reference

### Party Memory

Type 3+ characters of a sender/receiver name to see past customers:

```
Type: "John" → Shows: John Doe · 0712345678 · PKG-ABCD12 · 5 parcels
```

- Shows most frequent customers first
- Shows last label used
- Shows number of previous shipments

### Volumetric Calculator

The system automatically calculates:

```
Actual Weight: 2.5 kg
Dimensions: 40cm × 30cm × 20cm
Volumetric: (40 × 30 × 20) / 5000 = 4.8 kg

Charged: 4.8 kg (air freight)
```

### Label Preview

When you select a label, you can preview it:

1. Click "Choose Label" button
2. Search by typing part of the code
3. Click on label to select
4. Label preview shows the actual label design
5. Label is loaded into booking form

---

## Getting Help

If you need assistance:

1. **Check status messages** - They often explain what to do next
2. **Review this guide** - Common workflows are documented
3. **Contact support** - For technical issues or training

### What to Include When Reporting Issues:

- Time of issue
- Account type (rider/desker)
- Steps you were performing
- Any error messages shown
- Scanner type (gun/camera/keyboard)

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  Quick Reference - Counter                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. SCAN: Type or scan code in main box                     │
│  2. WAIT: System processes automatically                     │
│  3. FOLLOW: Complete required steps                         │
│  4. NEXT: Scan next code                                    │
│                                                              │
│  Common Codes:                                               │
│  • PKG-XXXXXX = Label for booking                           │
│  • TCK-XXXXXX = Ticket for receiving                        │
│                                                              │
│  Need Help?                                                  │
│  • Status messages explain what to do                       │
│  • "Choose Label" = Select a label                          │
│  • Camera button = Open scanner                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Version Information

- **Last Updated**: September 19, 2026
- **Counter Version**: Simplified UI
- **Support**: Contact Esoqo support for questions

---

*This guide covers the simplified Counter interface. Some advanced features may vary based on your account permissions.*
