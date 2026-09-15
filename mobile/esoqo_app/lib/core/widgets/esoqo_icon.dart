/// Esoqo's icon system — ported from packages/ui/src/Icon.tsx: 63 stroke
/// icons on a 24px grid, generated 1:1 from that file's SVG symbols into
/// assets/icons/*.svg (see the redesign notes; regenerate with the same
/// extraction script if packages/ui/src/Icon.tsx changes).
///
/// No emoji anywhere in this product — emoji render differently per
/// platform, are announced unpredictably by screen readers, and can't be
/// recoloured to match state (error/success/muted). Icons are decorative
/// by default; the text next to one always carries the meaning, never the
/// icon alone.
library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// One entry per file in assets/icons/ — keep in sync with
/// packages/ui/src/Icon.tsx's IconName union.
enum EsoqoIconName {
  alertCircle('alert-circle'),
  alertTriangle('alert-triangle'),
  arrowLeft('arrow-left'),
  arrowRight('arrow-right'),
  ban('ban'),
  bank('bank'),
  basket('basket'),
  box('box'),
  building('building'),
  calendar('calendar'),
  certificate('certificate'),
  chart('chart'),
  check('check'),
  checkCircle('check-circle'),
  chevronDown('chevron-down'),
  chevronRight('chevron-right'),
  clock('clock'),
  close('close'),
  coins('coins'),
  cow('cow'),
  document('document'),
  download('download'),
  eye('eye'),
  filter('filter'),
  gov('gov'),
  grid('grid'),
  handshake('handshake'),
  info('info'),
  key('key'),
  keypad('keypad'),
  leaf('leaf'),
  lock('lock'),
  mail('mail'),
  map('map'),
  menu('menu'),
  message('message'),
  phone('phone'),
  phoneCall('phone-call'),
  pin('pin'),
  plug('plug'),
  plus('plus'),
  print('print'),
  qr('qr'),
  refresh('refresh'),
  scales('scales'),
  seal('seal'),
  search('search'),
  send('send'),
  shield('shield'),
  shieldCheck('shield-check'),
  shop('shop'),
  sort('sort'),
  star('star'),
  tag('tag'),
  trendDown('trend-down'),
  trendFlat('trend-flat'),
  trendUp('trend-up'),
  truck('truck'),
  umbrella('umbrella'),
  user('user'),
  users('users'),
  wheat('wheat'),
  wifiOff('wifi-off');

  const EsoqoIconName(this.asset);
  final String asset;
}

/// Renders one [EsoqoIconName] at [size], tinted [color] (defaults to the
/// ambient [IconTheme], same convention as [Icon]). Decorative by default
/// — pass [semanticLabel] only on the rare icon that stands completely
/// alone with no adjacent text.
class EsoqoIcon extends StatelessWidget {
  const EsoqoIcon(
    this.name, {
    super.key,
    this.size,
    this.color,
    this.semanticLabel,
  });

  final EsoqoIconName name;
  final double? size;
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final iconTheme = IconTheme.of(context);
    final resolvedSize = size ?? iconTheme.size ?? 24;
    final resolvedColor =
        color ?? iconTheme.color ?? Theme.of(context).colorScheme.onSurface;
    return SvgPicture.asset(
      'assets/icons/${name.asset}.svg',
      width: resolvedSize,
      height: resolvedSize,
      colorFilter: ColorFilter.mode(resolvedColor, BlendMode.srcIn),
      semanticsLabel: semanticLabel,
      excludeFromSemantics: semanticLabel == null,
    );
  }
}
