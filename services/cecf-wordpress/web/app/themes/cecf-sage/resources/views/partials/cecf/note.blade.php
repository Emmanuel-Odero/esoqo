@php($variant = $data['variant'] ?? 'info')

{{--
  No .sec wrapper (72px padding) here on purpose — a note/callout/linkOut/
  linkRow sits between two full sections that already contribute their own
  top/bottom padding; this just needs its own small margin, not a third
  full section's worth of whitespace.
--}}
<div class="wrap" style="margin:28px auto">
  @if ($variant === 'fineprint')
    <p class="fineprint">{!! \App\Support\Markdown::inline($data['body'] ?? '') !!}</p>
  @else
    <div class="note{{ $variant === 'warn' ? ' warn' : '' }}">
      <x-icon :name="$variant === 'warn' ? 'warning' : 'info-circle'" />
      <p>{!! \App\Support\Markdown::inline($data['body'] ?? '') !!}</p>
    </div>
  @endif
</div>
