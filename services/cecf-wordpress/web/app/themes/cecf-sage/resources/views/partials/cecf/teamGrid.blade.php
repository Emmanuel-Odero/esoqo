@php($columns = $data['columns'] ?? 3)

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

    <div class="cards{{ $columns }} mt-l">
      @foreach ($data['items'] ?? [] as $person)
        @php($initials = \App\Support\Initials::of($person['name'] ?? ''))
        <div class="card member">
          <span class="avatar {{ $person['color'] ?? 'teal' }}">{{ $initials }}</span>
          <h3>{{ $person['name'] ?? '' }}</h3>
          @if (! empty($person['role']))
            <p class="role">{{ $person['role'] }}</p>
          @endif
          @if (! empty($person['bio']))
            <p>{!! \App\Support\Markdown::inline($person['bio']) !!}</p>
          @endif
          @if (! empty($person['email']))
            <a class="mono" href="mailto:{{ $person['email'] }}">{{ $person['email'] }}</a>
          @endif
        </div>
      @endforeach
    </div>
  </div>
</section>
