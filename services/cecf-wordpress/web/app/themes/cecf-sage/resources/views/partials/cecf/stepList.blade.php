@php($isColumn = ($data['layout'] ?? 'column') === 'column')

<section class="sec">
  <div class="wrap">
    @if (! empty($data['heading']))
      <h2>{{ $data['heading'] }}</h2>
    @endif
    <div class="steps4{{ $isColumn ? ' col' : '' }}">
      @foreach ($data['items'] ?? [] as $step)
        <div class="s4">
          <span class="n">{{ $step['n'] ?? '' }}</span>
          <h3>{{ $step['title'] ?? '' }}</h3>
          <p>{!! \App\Support\Markdown::inline($step['body'] ?? '') !!}</p>
        </div>
      @endforeach
    </div>
  </div>
</section>
