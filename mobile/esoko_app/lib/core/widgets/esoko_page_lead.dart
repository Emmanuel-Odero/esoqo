import 'package:flutter/material.dart';

/// Muted intro paragraph for pages whose title already lives in the AppBar
/// (Home-hub destinations: Shopping, Tickets, Groups, Bills). Before this,
/// those pages repeated the AppBar title in a big in-body header
/// ("Bills" under "Bills", "Travel & events" under "Tickets") — the page
/// title belongs to the bar, the body keeps only the orienting sentence.
class EsokoPageLead extends StatelessWidget {
  const EsokoPageLead(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(color: Theme.of(context).textTheme.bodySmall?.color),
    );
  }
}
