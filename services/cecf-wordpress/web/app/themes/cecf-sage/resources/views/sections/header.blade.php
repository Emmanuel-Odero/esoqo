@php($cta = $cecfSettings['primaryCta'] ?? null)

<header>
  <div class="hd">
    <a class="logo" href="{{ home_url('/') }}" aria-label="{{ $siteName }}, home">
      <span class="mark" style="color:#E8B563">
        <x-icon name="logo-mark" size="21" />
      </span>
      <span>
        <b>{{ $cecfSettings['orgShortName'] ?? $siteName }}</b>
        <span>{{ $cecfSettings['locationLine'] ?? '' }}</span>
      </span>
    </a>

    @if (has_nav_menu('primary_navigation'))
      <nav class="main" aria-label="{{ wp_get_nav_menu_name('primary_navigation') }}">
        {!! wp_nav_menu([
          'theme_location' => 'primary_navigation',
          'container' => false,
          'items_wrap' => '%3$s',
          'walker' => new \App\Support\Nav\CecfMenuWalker(),
          'echo' => false,
        ]) !!}
      </nav>
    @endif

    @if ($cta)
      <a class="btn btn-p btn-sm cta" href="{{ \App\Support\PageUrl::resolve($cta['page']) }}" style="padding:10px 18px;min-height:42px">
        <x-icon name="arrow-right" size="15" />{{ $cta['label'] }}
      </a>
    @endif

    <button class="burger" id="burger" aria-expanded="false" aria-controls="mnav" aria-label="{{ __('Menu', 'cecf-sage') }}">
      <x-icon name="menu" />
    </button>
  </div>
</header>

<div class="mscrim" id="mscrim"></div>
<nav class="mnav" id="mnav" aria-hidden="true" aria-label="{{ __('Menu', 'cecf-sage') }}">
  <div class="mnav-hd">
    <a class="logo" href="{{ home_url('/') }}">
      <span class="mark" style="color:#E8B563">
        <x-icon name="logo-mark" size="21" />
      </span>
      <span><b>{{ $cecfSettings['orgShortName'] ?? 'CECF' }}</b><span>Kenya</span></span>
    </a>
    <button id="mclose" aria-label="{{ __('Close menu', 'cecf-sage') }}">
      <x-icon name="close" />
    </button>
  </div>

  @if (has_nav_menu('primary_navigation'))
    {!! wp_nav_menu([
      'theme_location' => 'primary_navigation',
      'container' => false,
      'items_wrap' => '%3$s',
      'walker' => new \App\Support\Nav\CecfMobileMenuWalker(),
      'echo' => false,
    ]) !!}
  @endif

  @if ($cta)
    <div style="padding:20px">
      <a class="btn btn-p" href="{{ \App\Support\PageUrl::resolve($cta['page']) }}" style="width:100%">
        <x-icon name="arrow-right" size="16" />{{ $cta['label'] }}
      </a>
    </div>
  @endif
</nav>
