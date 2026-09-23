# Counter UI/UX Improvements - Technical Documentation

## Overview

This document explains the technical changes made to simplify the courier counter interface (`/parcel-org/counter`).

## Problems Identified

Users found the counter interface:

1. **Too complex** - Multiple overlapping features, scattered workflows
2. **Aesthetically intimidating** - Cluttered interface with too much text
3. **Disorganized** - Related features scattered across tabs
4. **Redundant** - Duplicate functionality between tabs

## Changes Made

### 1. Page Layout & Navigation (`OrgCounterClient.tsx`)

#### Before:

- No page header
- Complex tab navigation with verbose styling
- Inconsistent section organization

#### After:

- Clear page header with title and subtitle
- Clean pill-style tab navigation with consistent styling
- Badge counts with better visual hierarchy
- Active tabs use white background with shadow

```typescript
// Added page header
<div style={{ marginBottom: 24 }}>
  <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "var(--navy)" }}>
    Counter
  </h1>
  <p className="sub" style={{ margin: "6px 0 0", fontSize: ".9rem" }}>
    Manage shipments, receive parcels, and print labels
  </p>
</div>
```

### 2. Shipment Panel Redesign

#### Before:

- Mixed inline styles with no clear structure
- Fields scattered without grouping
- Excessive visual noise with decorative elements

#### After:

- Clean fieldset-based layout following DispatchBoard patterns
- Consistent `sectionStyle`, `gridStyle`, and `sectionTitleStyle` objects
- Grouped fields: Vehicle, Journey, Driver & Crew
- Clear visual hierarchy with uppercase section titles

```typescript
const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: "var(--r-md)",
  padding: "16px 18px",
  background: "var(--paper)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: ".72rem",
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--tx-2)",
  marginBottom: "12px",
};
```

### 3. Active Shipment View

#### Before:

- Dense header with mixed information
- KPI buried in layout
- Multiple background colors creating visual noise

#### After:

- Clean header with vehicle info and status pill
- Prominent KPI card with green background
- Consolidated scan bar with cleaner styling
- Clear action buttons with consistent hierarchy

### 4. Front Desk Worklist (`FrontDeskClient.tsx`)

#### Before:

- Table-based layout with many columns
- Verbose row styling
- Receipt card with excessive decoration

#### After:

- Card-based list with cleaner rows
- Consolidated receiver and destination on one line
- Cleaner receipt card with simplified header
- Compact offline queue banner

### 5. Scan Everything Bar (`ScanEverythingBar.tsx`)

#### Before:

- Large padding (28px)
- Multiple button styles
- Verbose header with icon and description

#### After:

- Compact padding (20px)
- Unified button heights
- Simplified header with icon in green circle
- Cleaner label picker popover

## Design Patterns Applied

### From DispatchBoard Component:

- Fieldset organization for form sections
- Consistent section title styling (uppercase, small, tracked)
- Grid layouts with `repeat(auto-fit, minmax(170px, 1fr))`
- Pill badges for status indicators

### From Pricing Editor:

- Inline editing patterns
- Clean table styling
- Minimal chrome

### From Design Tokens:

- Consistent use of `var(--r-md)`, `var(--r-sm)`, `var(--r-lg)` for border radius
- Consistent shadows: `var(--sh-s)` for cards
- Consistent spacing using `var(--sp-*)` scale

## Files Modified

1. **`apps/app/src/app/parcel-org/counter/OrgCounterClient.tsx`**
   - Added page header
   - Redesigned tab navigation
   - Simplified ShipmentPanel with fieldsets
   - Cleaned up active shipment view
   - Updated labels section header

2. **`apps/app/src/app/parcel-org/counter/FrontDeskClient.tsx`**
   - Converted table to card-based list
   - Simplified receipt card
   - Compact offline queue banner
   - Cleaner success state

3. **`apps/app/src/app/parcel-org/counter/ScanEverythingBar.tsx`**
   - Compact header and input
   - Unified button styling
   - Cleaner label picker

## Visual Improvements Summary

| Element        | Before           | After                  |
| -------------- | ---------------- | ---------------------- |
| Page header    | None             | Clear title + subtitle |
| Tab navigation | Verbose          | Pill-style, compact    |
| Form sections  | Scattered fields | Fieldset groupings     |
| Status pills   | Multiple styles  | Consistent pills       |
| Worklist       | Table            | Card-based list        |
| Scan bar       | Large padding    | Compact, focused       |
| KPI display    | Inline           | Prominent card         |

- Improved status messages
- Better visual organization

3. **`apps/app/src/app/parcel-org/ScanButton.tsx`**
   - Added error display area
   - Kept scanner modal open on errors
   - Better error messages

## Technical Implementation Details

### State Management

The component uses local state for:

- `view`: Current tab (`'receive' | 'book' | 'labels'`)
- `scanText`: Input field value
- `scanStatus`: Status message
- `pickerOpen`: Label picker visibility

### Routing Logic

```typescript
async function submit(raw: string) {
  const target = (extractParcelCode(raw.trim()) || raw.trim()).toUpperCase();

  if (target.startsWith("PKG-")) {
    // Label - route to booking
    onLoadLabel(target);
  } else if (target.startsWith("TCK-")) {
    // Ticket - route to receiving
    await runReceive(target);
  } else {
    // Fallback - try to receive
    if (canCarry) await runReceive(target);
  }
}
```

### Performance Considerations

- **Memoization**: `useMemo` for label matching
- **Debouncing**: Input changes handled natively by React
- **Lazy loading**: `ScanButton` dynamically imports `html5-qrcode`

### Accessibility

- Proper `aria-label` on inputs
- `role="tablist"` on navigation
- Semantic HTML for form elements
- Focus management

## Testing Recommendations

1. **Scanner Gun Testing**
   - Verify auto-focus behavior
   - Check Enter key submission
   - Test with various code formats

2. **Camera Scanning**
   - Test on multiple devices
   - Verify permission flow
   - Check error handling

3. **Workflow Testing**
   - Receive walk-in parcel
   - Create new shipment
   - Book against existing label
   - Label selection workflow

4. **Error Handling**
   - Invalid codes
   - Permission denied
   - Network errors

## Future Improvements

Potential enhancements:

1. Quick actions toolbar
2. Recent customers sidebar
3. Workflow shortcuts
4. Dark mode support
5. Mobile-optimized layout

## Rollback Instructions

If issues arise, the changes can be reverted by:

1. **Revert tab navigation**: Restore `counter-task-nav` class
2. **Revert scan bar**: Use previous layout
3. **Revert scanner errors**: Remove error display area

## Support

For questions about these changes, contact the development team.
