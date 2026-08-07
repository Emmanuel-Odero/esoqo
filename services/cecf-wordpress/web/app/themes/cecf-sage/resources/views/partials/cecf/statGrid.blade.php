{{--
  The template has two distinct components for this, not one component
  with a column-count variant: `.stat4` (4-up, white cards) and
  `.factbox` (3-up, teal-tinted cards) — every statGrid in the seeded
  content is one or the other, so columns===4 selects .stat4 and anything
  else selects .factbox.
--}}
@php($isStat4 = ($data['columns'] ?? 3) == 4)

<div class="wrap" style="margin:28px auto">
  @if (! empty($data['heading']))
    <h2>{{ $data['heading'] }}</h2>
  @endif

  @if ($isStat4)
    <div class="stat4">
      @foreach ($data['items'] ?? [] as $item)
        <div>
          <span class="n">{{ $item['value'] ?? '' }}</span>
          <span class="l">{{ $item['label'] ?? '' }}</span>
        </div>
      @endforeach
    </div>
  @else
    <div class="factbox">
      @foreach ($data['items'] ?? [] as $item)
        <div>
          <span class="fn">{{ $item['value'] ?? '' }}</span>
          <span class="fl">{{ $item['label'] ?? '' }}</span>
        </div>
      @endforeach
    </div>
  @endif

  @if (! empty($data['fineprint']))
    <p class="fineprint">{!! \App\Support\Markdown::inline($data['fineprint']) !!}</p>
  @endif
</div>
