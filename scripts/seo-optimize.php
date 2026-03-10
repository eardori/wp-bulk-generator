<?php
/**
 * SEO 최적화 PHP 스크립트 — wp eval-file로 실행
 * 사용법: wp eval-file /home/ubuntu/wp-bulk-generator/scripts/seo-optimize.php --allow-root --path=/var/www/SITE_DIR
 * 
 * 인자: $args[0] = persona 이름, $args[1] = 사이트 제목
 */

$persona = isset($args[0]) ? $args[0] : get_bloginfo('name');
$site_title = isset($args[1]) ? $args[1] : get_bloginfo('name');

$updated = 0;
$skipped = 0;
$errors = 0;

$posts = get_posts(array(
  'post_type'   => 'post',
  'post_status' => 'publish',
  'numberposts' => -1,
));

foreach ($posts as $post) {
  $title = wp_strip_all_tags($post->post_title);
  $short = mb_substr($title, 0, 35);
  $content = $post->post_content;

  // 이미 JSON-LD가 있으면 스킵
  if (strpos($content, 'application/ld+json') !== false) {
    $skipped++;
    echo "  ⏭ #{$post->ID} \"{$short}...\" (이미 적용됨)\n";
    continue;
  }

  // excerpt
  $excerpt = wp_strip_all_tags($post->post_excerpt ?: wp_trim_words($content, 30, ''));
  $excerpt = mb_substr($excerpt, 0, 160);

  // 이미지 alt 태그 개선
  $content = str_replace(
    'alt="실제 구매자 리뷰 사진"',
    'alt="' . esc_attr($title) . ' 실제 구매자 리뷰 사진"',
    $content
  );

  // Article Schema JSON-LD
  $schema = array(
    '@context'      => 'https://schema.org',
    '@type'         => 'Article',
    'headline'      => $title,
    'description'   => $excerpt,
    'author'        => array('@type' => 'Person', 'name' => $persona),
    'datePublished' => $post->post_date,
    'dateModified'  => $post->post_modified,
    'publisher'     => array('@type' => 'Organization', 'name' => $site_title),
  );

  $schema_html = "\n" . '<script type="application/ld+json">' . wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';

  // FAQ 추출 (h3 + 질문? 패턴)
  $faq_items = array();
  if (preg_match_all('/<h3[^>]*>(.*?\?.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/si', $content, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
      $q = wp_strip_all_tags($m[1]);
      $a = wp_strip_all_tags($m[2]);
      if (mb_strlen($a) > 20) {
        $faq_items[] = array(
          '@type' => 'Question',
          'name'  => $q,
          'acceptedAnswer' => array('@type' => 'Answer', 'text' => mb_substr($a, 0, 300)),
        );
      }
    }
  }

  if (!empty($faq_items)) {
    $faq_schema = array(
      '@context'   => 'https://schema.org',
      '@type'      => 'FAQPage',
      'mainEntity' => array_slice($faq_items, 0, 10),
    );
    $schema_html .= "\n" . '<script type="application/ld+json">' . wp_json_encode($faq_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
  }

  // 업데이트
  $new_content = $content . $schema_html;
  $result = wp_update_post(array(
    'ID'           => $post->ID,
    'post_content' => $new_content,
  ), true);

  if (is_wp_error($result)) {
    $errors++;
    echo "  ❌ #{$post->ID} \"{$short}...\" — " . $result->get_error_message() . "\n";
  } else {
    // Yoast meta 업데이트
    update_post_meta($post->ID, '_yoast_wpseo_title', mb_substr($title, 0, 60));
    update_post_meta($post->ID, '_yoast_wpseo_metadesc', mb_substr($excerpt, 0, 155));

    $faq_count = count($faq_items);
    $faq_label = $faq_count > 0 ? " + FAQ({$faq_count})" : '';
    $updated++;
    echo "  ✅ #{$post->ID} \"{$short}...\" — Schema{$faq_label} + Yoast\n";
  }
}

echo "\nRESULT:{$updated}:{$skipped}:{$errors}\n";
