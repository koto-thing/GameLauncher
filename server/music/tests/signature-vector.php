<?php
declare(strict_types=1);
$vector = json_decode(file_get_contents(__DIR__ . '/../../../contracts/music/signature-vector.json'), true, 32, JSON_THROW_ON_ERROR);
$actual = hash_hmac('sha256', "PandD-Music-v1\n" . $vector['encoded'], $vector['secret']);
if (!hash_equals($vector['signature'], $actual)) throw new RuntimeException('Signature vector mismatch');
echo "PHP fixed signature vector passed.\n";
