<section class="sec">
  <div class="wrap">
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    <div class="news">
      @foreach ($data['items'] ?? [] as $item)
        <article class="nw">
          @if (! empty($item['date']))
            <span class="ndate">{{ $item['date'] }}</span>
          @endif
          @if (! empty($item['tag']))
            <span class="stag">{{ $item['tag'] }}</span>
          @endif
          <h3>{{ $item['title'] ?? '' }}</h3>
          @foreach ($item['body'] ?? [] as $paragraph)
            <p class="lead">{!! \App\Support\Markdown::inline($paragraph) !!}</p>
          @endforeach
        </article>
      @endforeach
    </div>
  </div>
</section>
