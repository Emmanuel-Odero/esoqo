{{--
  The template has two column-width ratios for a 3-column table (a plain
  one, and a wider-middle-column ".th3" variant) but nothing in the seed
  schema records which one a given table wants — a purely cosmetic ratio
  difference, so this always uses the plain ratio rather than guess at a
  heuristic for something that reads fine either way.
--}}
<section class="sec">
  <div class="wrap">
    @if (! empty($data['kicker']))
      <p class="kick">{{ $data['kicker'] }}</p>
    @endif
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    @if (! empty($data['lead']))
      <p class="lead">{!! \App\Support\Markdown::inline($data['lead']) !!}</p>
    @endif

    <div class="tbl">
      <div class="tr th">
        @foreach ($data['columns'] ?? [] as $column)
          <span>{{ $column }}</span>
        @endforeach
      </div>
      @foreach ($data['rows'] ?? [] as $row)
        <div class="tr">
          @foreach ($row as $cell)
            <span>{{ $cell }}</span>
          @endforeach
        </div>
      @endforeach
    </div>

    @if (! empty($data['fineprint']))
      <p class="fineprint">{!! \App\Support\Markdown::inline($data['fineprint']) !!}</p>
    @endif
  </div>
</section>
